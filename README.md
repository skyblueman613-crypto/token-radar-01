# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/skyblueman613-crypto/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/skyblueman613-crypto/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for protocols that have not issued a token yet. It reads the sealed DefiLlama snapshot of 758 protocols, finds the 40 on the watchlist — every protocol with at least $50M of TVL and no token on record — and ranks 198 genuinely pre-token protocols by an implied value the model derives from the snapshot itself. The other 536 protocols are not dropped silently: 24 sit in the live-token table (the top 24 by market cap) and the rest are listed in a coverage section with the reason each is excluded — has a token below the live table's top 24, a bridge, liquid staking or restaking, an exchange, a versioned pool, or a wrapped or staked product — so all 758 protocols are accounted for.

The model ("radar-2") is calibrated, not hardcoded: for each category it takes the median market-cap-to-TVL ratio of the live-token protocols in that category (at least 3 live protocols, clamped to 0.05x–1.2x), falling back to the global median of 0.214x where a category has too few live protocols to calibrate. Implied value is then TVL × category multiple × a growth multiplier (from the 7-day TVL change, clamped to −60%/+120%) × a maturity multiplier (how long the protocol has run with no token, up to 3 years). The full watchlist exclusion rule — bridges, liquid staking and restaking, wrapped and staked products, exchanges, versioned pools — is applied to every row, not just to the watchlist, so no bridged or staked product ever ranks as a pre-token protocol. Every row carries a six-step farm plan with the capital it needs and the time it takes, and the dashboard recomputes each row's implied value in the page and states whether it agrees with board.json.

The dashboard is a dark radar room: a KPI strip with the headline numbers (758 of 758 protocols accounted for, 40 of 40 on the watchlist, 24 live-token protocols shown of 416, 14 of 34 categories calibrated on their own medians, the global median multiple of 0.214x and the top implied value), an integrity strip with six checkable claims about where the numbers come from, a top-ten chart, search, category and chain filters, a watchlist-only toggle, a sortable board, a live-token table set aside, a calibration table showing every category's multiple and how many live protocols back it, a detail view per protocol with the full implied-value equation and its farm plan, and a coverage section that accounts for all 758 protocols. It renders with no network at all.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Node 22 or later, standard library only. `main.ts` reads the snapshot, writes `board.json` (198 ranked rows), `data.js`, the dashboard and screenshots into `out/`, and `dossier.json` last. Run it twice and the outputs are byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?ref=e3r9kvpr&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
