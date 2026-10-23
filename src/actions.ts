import type { Action, ActionExample, HandlerCallback, IAgentRuntime, Memory } from "@elizaos/core";
import { callPaid, readPrivateKey, BaseGasConfigError } from "./client.js";
import { parseGasLimit, parseHours } from "./parse.js";

type Route = {
  name: string;
  similes: string[];
  description: string;
  price: string;
  path: (text: string) => string;
  summarize: (data: any) => string;
  examples: ActionExample[][];
};

const usd = (v: unknown) => (v === null || v === undefined ? "n/a" : `$${v}`);

const ask = (user: string, agent: string, action: string): ActionExample[] => [
  { name: "{{user1}}", content: { text: user } },
  { name: "{{agent}}", content: { text: agent, actions: [action] } },
];

function makeAction(route: Route): Action {
  return {
    name: route.name,
    similes: route.similes,
    description: `${route.description} Costs about ${route.price} in USDC on Base, paid automatically over x402. Do not call it repeatedly for the same question.`,
    // Offered to the model only when a wallet is configured; a malformed key
    // still counts as configured so the user gets the error explained.
    validate: async (runtime: IAgentRuntime) => {
      try {
        return readPrivateKey(runtime) !== null;
      } catch {
        return true;
      }
    },
    handler: async (runtime: IAgentRuntime, message: Memory, _state, _options, callback?: HandlerCallback) => {
      const text = String(message.content?.text ?? "");
      try {
        const { data, tx } = await callPaid(runtime, route.path(text));
        const summary = route.summarize(data);
        await callback?.({ text: summary, actions: [route.name] });
        return { success: true, text: summary, data: { response: data, paymentTx: tx } };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const text = err instanceof BaseGasConfigError ? reason : `Could not get Base gas data: ${reason}`;
        await callback?.({ text, actions: [route.name] });
        return { success: false, text, error: reason };
      }
    },
    examples: route.examples,
  };
}

export const getBaseGas = makeAction({
  name: "GET_BASE_GAS",
  similes: ["BASE_GAS_PRICE", "CHECK_GAS", "TRANSACTION_COST", "GAS_FEE"],
  description:
    "Live Base mainnet gas: base fee, priority tiers, the cost of a transaction in USD, and ready-to-sign maxFeePerGas / maxPriorityFeePerGas.",
  price: "$0.002",
  path: (text) => {
    const gas = parseGasLimit(text);
    return gas ? `/gas?gasLimit=${gas}` : "/gas";
  },
  summarize: (d) => {
    const c = d.estimatedTransferCost ?? {};
    const m = d.suggestedFees?.medium;
    const fees = m ? ` To send now use maxFeePerGas ${m.maxFeePerGas} wei and maxPriorityFeePerGas ${m.maxPriorityFeePerGas} wei.` : "";
    return `Base gas: base fee ${d.baseFeePerGas} gwei, medium priority ${d.priorityFeePerGas?.medium} gwei. A ${c.gasLimit}-gas transaction costs about ${usd(c.usd)}.${fees}`;
  },
  examples: [
    ask("What is gas on Base right now?", "Checking live Base gas.", "GET_BASE_GAS"),
    ask("How much does a Uniswap swap on Base cost?", "Pricing a swap on Base.", "GET_BASE_GAS"),
  ],
});

export const compareGasCosts = makeAction({
  name: "COMPARE_GAS_COSTS",
  similes: ["CHEAPEST_CHAIN", "COMPARE_L2_FEES", "GAS_COMPARISON"],
  description: "Live cost of the same transaction on Base, OP Mainnet, Arbitrum One and Ethereum, in USD, cheapest first.",
  price: "$0.01",
  path: (text) => {
    const gas = parseGasLimit(text);
    return gas ? `/gas/compare?gasLimit=${gas}` : "/gas/compare";
  },
  summarize: (d) => {
    const ranking = (d.chains ?? []).map((c: any) => `${c.label} ${usd(c.estimatedCost?.usd)}`).join(", ");
    return `Cheapest right now: ${d.cheapest}. For ${d.gasLimit} gas: ${ranking}.`;
  },
  examples: [ask("Which chain is cheapest to send on, Base or Arbitrum?", "Comparing live costs.", "COMPARE_GAS_COSTS")],
});

export const getGasHistory = makeAction({
  name: "GET_GAS_HISTORY",
  similes: ["IS_GAS_HIGH", "GAS_TREND", "GAS_VERDICT"],
  description: "Base gas over a lookback window (default 24h, up to 7 days) with a cheap / normal / expensive / flat verdict for right now.",
  price: "$0.01",
  path: (text) => {
    const h = parseHours(text);
    return h ? `/gas/history?hours=${h}` : "/gas/history";
  },
  summarize: (d) => `Verdict for the last ${d.requestedHours}h: ${d.verdict ?? "not enough data"}. ${d.verdictNote ?? ""}`.trim(),
  examples: [ask("Is Base gas high right now or should I wait?", "Checking against recent history.", "GET_GAS_HISTORY")],
});

export const getCheapestWindow = makeAction({
  name: "GET_CHEAPEST_GAS_WINDOW",
  similes: ["BEST_TIME_TO_TRANSACT", "CHEAPEST_HOUR", "SCHEDULE_TRANSACTION"],
  description: "From up to 7 days of Base gas history: hours to avoid, the cheapest hour (UTC), and the saving in percent and USD. Says plainly when timing saves nothing.",
  price: "$0.02",
  path: (text) => {
    const h = parseHours(text);
    return h ? `/gas/cheapest-window?hours=${h}` : "/gas/cheapest-window";
  },
  summarize: (d) => d.recommendation ?? "No recommendation returned.",
  examples: [ask("When is the cheapest time to transact on Base?", "Looking at the last week of gas.", "GET_CHEAPEST_GAS_WINDOW")],
});

export const actions = [getBaseGas, compareGasCosts, getGasHistory, getCheapestWindow];
