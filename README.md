# plugin-base-gas

elizaOS plugin for live Base mainnet gas. Your agent can answer "what does this transaction cost?", "which chain is cheapest?", "is gas high right now?" and "when should I send?", and gets ready-to-sign `maxFeePerGas` / `maxPriorityFeePerGas` for its own transactions.

Data comes from [base-gas-x402](https://github.com/memosr/base-gas-x402), paid per call in USDC on Base over [x402](https://www.x402.org). No account, no API key: the agent's wallet pays a fraction of a cent per answer.

## Actions

| Action | Answers | Price |
|---|---|---|
| `GET_BASE_GAS` | Base fee, priority tiers, cost of a transaction in USD, ready-to-sign fees | ~$0.002 |
| `COMPARE_GAS_COSTS` | The same transaction on Base, OP Mainnet, Arbitrum One and Ethereum, cheapest first | ~$0.01 |
| `GET_GAS_HISTORY` | Up to 7 days of Base gas with a cheap / normal / expensive / flat verdict | ~$0.01 |
| `GET_CHEAPEST_GAS_WINDOW` | Hours to avoid and the cheapest hour (UTC), with the saving in percent and USD | ~$0.02 |

The plugin reads the operation from the message: "swap" prices 180,000 gas, "mint" 85,000, "send USDC" 65,000, "deploy" 1,500,000, or pass a number ("price 250,000 gas"). Time windows work the same way ("last 6 hours", "this week").

## Install

```bash
elizaos plugins add @memosr/plugin-base-gas
```

Add it to your character:

```json
{
  "plugins": ["@memosr/plugin-base-gas"]
}
```

## Settings

| Setting | Required | Description |
|---|---|---|
| `BASE_GAS_PRIVATE_KEY` | No* | Private key of a Base wallet holding a little USDC. No ETH needed. |
| `EVM_PRIVATE_KEY` | No* | Used when `BASE_GAS_PRIVATE_KEY` is not set (the same key plugin-evm uses). |
| `BASE_GAS_MAX_USD_PER_CALL` | No | Hard cap per payment in USD. Default `0.05`. |

\* One of the two keys is needed. Without a wallet the actions are not offered to the model.

## Safety

- **Fixed payee.** The plugin only ever pays `base-gas-x402-production.up.railway.app`. The URL is in code, never taken from a message, so injected text cannot point the wallet anywhere else.
- **Hard cap.** Any payment above `BASE_GAS_MAX_USD_PER_CALL` is refused before anything is signed.
- **Bounded inputs.** Only a validated gas limit (21,000 to 30,000,000) and an hour count (1 to 168) reach the request.
- **Use a small wallet.** A dedicated `BASE_GAS_PRIVATE_KEY` with a few dollars of USDC is the safest setup.

## Development

```bash
npm install
npm test   # builds, then runs the tests against a local fake of the paid API
```

## Related

- API and docs: [base-gas-x402.vercel.app](https://base-gas-x402.vercel.app)
- MCP server: [base-gas-mcp](https://www.npmjs.com/package/base-gas-mcp)
- Agent skill: [base-gas-skill](https://github.com/memosr/base-gas-skill)

## License

MIT
