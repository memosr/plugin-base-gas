import type { Plugin } from "@elizaos/core";
import { actions } from "./actions.js";

export const baseGasPlugin: Plugin = {
  name: "base-gas",
  description:
    "Live Base gas, transaction cost in USD, ready-to-sign fees, cross-chain comparison and best time to transact, paid per call in USDC over x402.",
  actions,
};

export { actions } from "./actions.js";
export { ORIGIN, DEFAULT_MAX_USD_PER_CALL } from "./client.js";
export { parseGasLimit, parseHours } from "./parse.js";
export default baseGasPlugin;
