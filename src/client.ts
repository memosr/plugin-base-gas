import type { IAgentRuntime } from "@elizaos/core";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The only origin this plugin pays. It is fixed in code and never taken from a
 * message: an origin chosen by the model would let injected text point the
 * wallet at an arbitrary paid endpoint.
 */
export const ORIGIN = "https://base-gas-x402-production.up.railway.app";

/** Base mainnet, CAIP-2 id used by the x402 client registry. */
const NETWORK = "eip155:8453";

/** Default hard cap per payment. The routes cost $0.002 to $0.02. */
export const DEFAULT_MAX_USD_PER_CALL = "0.05";

export class BaseGasConfigError extends Error {}

/**
 * Wallet key for payments. A dedicated BASE_GAS_PRIVATE_KEY wins; otherwise
 * the agent's EVM_PRIVATE_KEY (the setting plugin-evm uses) is reused, so a
 * character that already has a wallet needs no extra setup.
 */
export function readPrivateKey(runtime: IAgentRuntime): `0x${string}` | null {
  const raw = String(runtime.getSetting("BASE_GAS_PRIVATE_KEY") ?? runtime.getSetting("EVM_PRIVATE_KEY") ?? "").trim();
  if (!raw) return null;
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new BaseGasConfigError("The wallet key is malformed: expected 32 bytes of hex.");
  }
  return key as `0x${string}`;
}

export function readMaxUsd(runtime: IAgentRuntime): string {
  const raw = String(runtime.getSetting("BASE_GAS_MAX_USD_PER_CALL") ?? "").trim() || DEFAULT_MAX_USD_PER_CALL;
  if (!/^\d+(\.\d{1,6})?$/.test(raw) || Number(raw) <= 0) {
    throw new BaseGasConfigError(`BASE_GAS_MAX_USD_PER_CALL must be a positive dollar amount, got "${raw}".`);
  }
  return raw;
}

type Paying = { fetchWithPay: typeof fetch; address: string; maxUsd: string };
const cache = new WeakMap<IAgentRuntime, Paying>();

function payingFetch(runtime: IAgentRuntime): Paying {
  const cached = cache.get(runtime);
  if (cached) return cached;
  const key = readPrivateKey(runtime);
  if (!key) {
    throw new BaseGasConfigError(
      "No wallet configured. Set BASE_GAS_PRIVATE_KEY (or EVM_PRIVATE_KEY) to a Base wallet holding a little USDC.",
    );
  }
  const maxUsd = readMaxUsd(runtime);
  const account = privateKeyToAccount(key);
  const client = new x402Client()
    .register(NETWORK, new ExactEvmScheme(account))
    // Refuse any payment above the cap before anything is signed.
    .setSpendControls({ maxAmountPerPayment: `$${maxUsd}` });
  const paying = { fetchWithPay: wrapFetchWithPayment(fetch, client) as typeof fetch, address: account.address, maxUsd };
  cache.set(runtime, paying);
  return paying;
}

export type PaidResult = { data: any; tx: string | null; payer: string };

/**
 * GETs a paid route of the gas API, paying over x402.
 * @param path Route path with query string, e.g. "/gas?gasLimit=180000".
 * @param origin Overridable for tests only.
 */
export async function callPaid(runtime: IAgentRuntime, path: string, origin = ORIGIN): Promise<PaidResult> {
  const { fetchWithPay, address, maxUsd } = payingFetch(runtime);
  let res: Response;
  try {
    res = await fetchWithPay(`${origin}${path}`, { headers: { Accept: "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/spend|exceed|max.*amount|rejected/i.test(message)) {
      throw new Error(`Payment refused: the gas API asked for more than the $${maxUsd} per-call cap.`);
    }
    throw new Error(`Could not reach the gas API: ${message}`);
  }
  if (!res.ok) {
    const hint =
      res.status === 402 ? " Payment was not accepted; check that the wallet holds USDC on Base."
      : res.status === 429 ? " Rate limited; nothing was charged, retry in a minute."
      : "";
    throw new Error(`The gas API returned HTTP ${res.status}.${hint}`);
  }
  const data = await res.json();
  let tx: string | null = null;
  const receipt = res.headers.get("payment-response");
  if (receipt) {
    try {
      tx = decodePaymentResponseHeader(receipt)?.transaction ?? null;
    } catch {
      tx = null;
    }
  }
  return { data, tx, payer: address };
}

/** Test hook: forget cached clients so a test can swap settings. */
export function __resetClientsForTests(runtime: IAgentRuntime) {
  cache.delete(runtime);
}
