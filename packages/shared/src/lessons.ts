// packages/shared/src/lessons.ts

export type TrackId = "fundamentals" | "markets" | "safety";

export type LessonId =
  | "fundamentals/what-is-bitcoin"
  | "fundamentals/what-is-ethereum"
  | "fundamentals/wallets"
  | "fundamentals/keys"
  | "fundamentals/stablecoins"
  | "fundamentals/gas"
  | "fundamentals/cex-vs-dex"
  | "fundamentals/mining-staking"
  | "fundamentals/nfts"
  | "fundamentals/layer-1-vs-layer-2"
  | "markets/volatility"
  | "markets/liquidity"
  | "markets/bid-ask"
  | "markets/market-cap"
  | "markets/cycles"
  | "safety/phishing"
  | "safety/2fa"
  | "safety/cold-storage"
  | "safety/rug-pulls"
  | "safety/seed-phrase";

export interface LessonStep {
  kind: "concept" | "example" | "summary";
  body: string;
  bullets?: string[];
}

export interface LessonQuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

export interface Lesson {
  id: LessonId;
  trackId: TrackId;
  order: number;
  title: string;
  steps: LessonStep[];
  quiz: LessonQuizQuestion;
}

export interface Track {
  id: TrackId;
  title: string;
  pastel: import("./assets.js").AssetPastel;
  lessonIds: LessonId[];
}

// ---------------------------------------------------------------------------
// TRACKS
// ---------------------------------------------------------------------------

export const TRACKS: readonly Track[] = [
  {
    id: "fundamentals",
    title: "Fundamentals",
    pastel: "peach",
    lessonIds: [
      "fundamentals/what-is-bitcoin",
      "fundamentals/what-is-ethereum",
      "fundamentals/wallets",
      "fundamentals/keys",
      "fundamentals/stablecoins",
      "fundamentals/gas",
      "fundamentals/cex-vs-dex",
      "fundamentals/mining-staking",
      "fundamentals/nfts",
      "fundamentals/layer-1-vs-layer-2",
    ],
  },
  {
    id: "markets",
    title: "Markets",
    pastel: "mint",
    lessonIds: [
      "markets/volatility",
      "markets/liquidity",
      "markets/bid-ask",
      "markets/market-cap",
      "markets/cycles",
    ],
  },
  {
    id: "safety",
    title: "Safety",
    pastel: "lilac",
    lessonIds: [
      "safety/phishing",
      "safety/2fa",
      "safety/cold-storage",
      "safety/rug-pulls",
      "safety/seed-phrase",
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// LESSONS
// ---------------------------------------------------------------------------

export const LESSONS: readonly Lesson[] = [
  // =========================================================================
  // FUNDAMENTALS — 10 lessons
  // =========================================================================

  // ---- POLISHED: fundamentals/what-is-bitcoin ----------------------------
  {
    id: "fundamentals/what-is-bitcoin",
    trackId: "fundamentals",
    order: 1,
    title: "What is Bitcoin?",
    steps: [
      {
        kind: "concept",
        body:
          "Bitcoin is a decentralised digital ledger — a chain of blocks of " +
          "transactions replicated across tens of thousands of computers " +
          "worldwide. No bank, government, or company controls it. Every " +
          "transaction is validated using SHA-256 cryptographic hashing, and " +
          "miners compete to add the next block through proof-of-work. The " +
          "very first block — the genesis block — was mined by Satoshi " +
          'Nakamoto on 3 January 2009, embedding the headline "Chancellor on ' +
          'brink of second bailout for banks" as a timestamp and a statement.',
      },
      {
        kind: "concept",
        body:
          "Bitcoin's supply is capped at exactly 21 million coins, enforced " +
          "not by a central authority but by the protocol code itself. Every " +
          "~210,000 blocks (roughly four years) the block reward halves — " +
          "from 50 BTC at launch, to 25, to 12.5, and so on until the last " +
          "fraction is mined around the year 2140. This contrasts sharply " +
          "with fiat currencies, where central banks can expand supply " +
          "through policy decisions alone.",
        bullets: [
          "2009 — 50 BTC reward at genesis",
          "2012 — first halving → 25 BTC",
          "2024 — fourth halving → 3.125 BTC",
          "~2140 — final satoshi mined, reward reaches zero",
        ],
      },
      {
        kind: "example",
        body:
          "Alice wants to send 0.01 BTC to Bob. Her wallet signs the " +
          "transaction with her private key and broadcasts it to the peer-to-" +
          "peer network. Within seconds, thousands of nodes relay it to " +
          "miners. A miner includes it in the next block and solves the " +
          "proof-of-work puzzle. Once that block is added to the chain, " +
          "the transaction has one confirmation. After six confirmations " +
          "(~60 minutes), it is considered effectively irreversible — " +
          "changing it would require re-doing more computational work than " +
          "the rest of the network combined.",
      },
      {
        kind: "summary",
        body:
          "Bitcoin represents digital scarcity: the first time in history " +
          "that a purely digital asset cannot be copied or inflated away. " +
          "Its censorship-resistance comes from decentralisation — nobody " +
          "can freeze your funds or change the rules without the consensus " +
          "of the global network. The key insight: Bitcoin's value " +
          "proposition rests on code and cryptography, not trust in any " +
          "single institution.",
        bullets: [
          "Decentralised: no single point of control",
          "Hard cap: 21 million coins, enforced by code",
          "Immutable: rewriting history is computationally infeasible",
          "Permissionless: anyone with internet access can participate",
        ],
      },
    ],
    quiz: {
      question: "What enforces Bitcoin's hard cap of 21 million coins?",
      options: [
        "A United Nations treaty signed by participating nations",
        "Satoshi Nakamoto, who holds a master private key",
        "The protocol code itself, which halves the block reward to zero by ~2140",
        "The largest mining pools, who agreed not to mine beyond the cap",
      ],
      correctIndex: 2,
    },
  },

  // ---- STUB: fundamentals/what-is-ethereum --------------------------------
  {
    id: "fundamentals/what-is-ethereum",
    trackId: "fundamentals",
    order: 2,
    title: "What is Ethereum?",
    steps: [
      {
        kind: "concept",
        body:
          "Ethereum is a programmable blockchain that introduced smart " +
          "contracts — self-executing code stored on-chain that runs " +
          "exactly as written, without any intermediary. The Ethereum " +
          "Virtual Machine (EVM) is the sandboxed runtime that executes " +
          "this code identically on every node in the network.",
      },
      {
        kind: "concept",
        body:
          "ETH is the native fuel of the Ethereum network: every " +
          "computation costs gas, paid in ETH, which compensates " +
          "validators and prevents spam. Unlike Bitcoin, Ethereum's " +
          "roadmap prioritises programmability over strict monetary " +
          "scarcity, making it the platform of choice for DeFi, NFTs, " +
          "and DAOs.",
      },
      {
        kind: "summary",
        body:
          "Ethereum extends Bitcoin's idea of trustless value transfer " +
          "to trustless computation. If Bitcoin is digital gold, Ethereum " +
          "is a decentralised world computer — though this power comes " +
          "with higher complexity and gas costs to match.",
        bullets: [
          "Smart contracts: code that runs without a middleman",
          "EVM: the shared runtime across all nodes",
          "Gas: execution fees paid in ETH",
        ],
      },
    ],
    quiz: {
      question: "What is the primary purpose of 'gas' on Ethereum?",
      options: [
        "To give ETH holders voting rights on protocol upgrades",
        "To pay validators for the computation required to run smart contracts",
        "To slow down transactions and prevent front-running",
        "To convert ETH into stablecoins automatically",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: fundamentals/wallets -----------------------------------------
  {
    id: "fundamentals/wallets",
    trackId: "fundamentals",
    order: 3,
    title: "What is a Wallet?",
    steps: [
      {
        kind: "concept",
        body:
          "A crypto wallet does not store coins — it stores the private " +
          "keys that prove ownership of on-chain assets. Custodial wallets " +
          "(like a Coinbase account) hold your keys for you, meaning you " +
          "trust the platform. Self-custody wallets (like MetaMask or a " +
          "hardware wallet) give you sole control.",
      },
      {
        kind: "concept",
        body:
          "The trade-off is simple: custodial wallets are more convenient " +
          "and recoverable via email, but the exchange can freeze your " +
          "account or be hacked. Self-custody wallets put you in full " +
          "control, but if you lose your seed phrase there is no reset " +
          "button — your funds are gone permanently.",
      },
      {
        kind: "summary",
        body:
          '"Not your keys, not your coins" is the maxim of self-custody. ' +
          "For small amounts or frequent trading a custodial wallet is fine; " +
          "for meaningful holdings, self-custody is the industry-standard " +
          "best practice.",
        bullets: [
          "Custodial: convenient, recoverable, exchange risk",
          "Self-custody: full control, no recovery if seed is lost",
        ],
      },
    ],
    quiz: {
      question: "What does a crypto wallet actually store?",
      options: [
        "Encrypted copies of your cryptocurrency coins",
        "Private keys that prove ownership of on-chain assets",
        "A backup of the blockchain up to your last transaction",
        "Your government ID for KYC verification",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: fundamentals/keys --------------------------------------------
  {
    id: "fundamentals/keys",
    trackId: "fundamentals",
    order: 4,
    title: "Public Keys vs Private Keys",
    steps: [
      {
        kind: "concept",
        body:
          "A private key is a randomly generated 256-bit number that acts " +
          "as your cryptographic identity — whoever holds it controls the " +
          "associated funds. A public key (and its derived address) is " +
          "mathematically derived from the private key and is safe to " +
          "share; it is how others send funds to you.",
      },
      {
        kind: "example",
        body:
          "Think of your public address as a padlocked mailbox slot: " +
          "anyone can drop a letter in (send you funds), but only you " +
          "hold the key that opens the box (the private key to spend). " +
          "Exposing your private key is equivalent to handing someone " +
          "that key — they can empty the mailbox instantly.",
      },
      {
        kind: "summary",
        body:
          "Your public key is your username; your private key is your " +
          "password, your identity, and your vault key combined into one. " +
          "Never share it, screenshot it, or paste it online under any " +
          "circumstances.",
        bullets: [
          "Public key / address: share freely to receive funds",
          "Private key: never share — full control of funds",
          "Loss of private key = permanent loss of access",
        ],
      },
    ],
    quiz: {
      question: "A friend asks for your public address to send you some ETH. What should you do?",
      options: [
        "Refuse — sharing any key information is dangerous",
        "Share your public address — it is designed to be shared",
        "Share your private key so they can create the transaction for you",
        "Send them your seed phrase so they can verify the address",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: fundamentals/stablecoins -------------------------------------
  {
    id: "fundamentals/stablecoins",
    trackId: "fundamentals",
    order: 5,
    title: "What is a Stablecoin?",
    steps: [
      {
        kind: "concept",
        body:
          "Stablecoins are cryptocurrencies designed to maintain a stable " +
          "value, usually pegged 1:1 to a fiat currency like the US dollar. " +
          "They combine the programmability of crypto with the price " +
          "predictability of traditional money, making them the backbone " +
          "of DeFi lending, trading, and payments.",
      },
      {
        kind: "concept",
        body:
          "There are three main types: fiat-backed (USDC, USDT — " +
          "centralised, redeemable for real dollars); crypto-backed " +
          "(DAI — over-collateralised with ETH, governed by MakerDAO); " +
          "and algorithmic (no reserve, use code to manage supply — " +
          "historically high-risk, as the Terra/LUNA collapse showed).",
        bullets: [
          "USDC / USDT: issued by companies, audited reserves",
          "DAI: on-chain collateral, decentralised governance",
          "Algorithmic: no direct backing — handle with extreme caution",
        ],
      },
      {
        kind: "summary",
        body:
          "Stablecoins let you park value in crypto rails without " +
          "exposure to volatility — useful between trades or while " +
          "earning yield. Always check the issuer's transparency reports; " +
          "not all dollar pegs are equal.",
      },
    ],
    quiz: {
      question: "Which stablecoin type carries the highest counterparty risk?",
      options: [
        "Fiat-backed stablecoins like USDC issued by regulated companies",
        "Crypto-backed stablecoins like DAI, backed by on-chain collateral",
        "Algorithmic stablecoins with no direct reserve backing",
        "All stablecoins carry identical risk profiles",
      ],
      correctIndex: 2,
    },
  },

  // ---- STUB: fundamentals/gas ---------------------------------------------
  {
    id: "fundamentals/gas",
    trackId: "fundamentals",
    order: 6,
    title: "Gas Fees Explained",
    steps: [
      {
        kind: "concept",
        body:
          "Gas is the unit measuring the computational work required to " +
          "execute an Ethereum transaction or smart contract. You pay gas " +
          "fees in ETH to compensate validators; the fee equals gas used " +
          "multiplied by the gas price you set, denominated in gwei " +
          "(1 gwei = 0.000000001 ETH).",
      },
      {
        kind: "concept",
        body:
          "Gas prices fluctuate with network demand — during NFT mints " +
          "or market crashes, fees can spike to hundreds of dollars for a " +
          "single swap. Practical tips: use Layer 2 networks for routine " +
          "transactions, set a max fee limit, and check gas trackers " +
          "before transacting.",
        bullets: [
          "Low demand (nights / weekends): cheaper gas",
          "High demand (major events): gas can spike 10-50×",
          "L2 networks: typically 10-100× cheaper than mainnet",
        ],
      },
      {
        kind: "summary",
        body:
          "Gas fees are Ethereum's market-based spam prevention and " +
          "validator compensation mechanism. Understanding them helps you " +
          "time transactions cheaply and choose the right network for the " +
          "right task.",
      },
    ],
    quiz: {
      question: "What determines the gas fee you pay on Ethereum mainnet?",
      options: [
        "A fixed fee set by the Ethereum Foundation",
        "The USD value of your transaction",
        "The computational complexity of the operation multiplied by the current gas price",
        "The number of tokens in your wallet",
      ],
      correctIndex: 2,
    },
  },

  // ---- STUB: fundamentals/cex-vs-dex --------------------------------------
  {
    id: "fundamentals/cex-vs-dex",
    trackId: "fundamentals",
    order: 7,
    title: "CEX vs DEX",
    steps: [
      {
        kind: "concept",
        body:
          "A centralised exchange (CEX) like Coinbase or Binance acts as " +
          "the custodian of your funds, runs an internal order book, and " +
          "requires KYC. It is fast, liquid, and user-friendly — but you " +
          "are trusting a company with your assets and your identity.",
      },
      {
        kind: "concept",
        body:
          "A decentralised exchange (DEX) like Uniswap runs entirely on " +
          "smart contracts; you trade directly from your own wallet, " +
          "retaining custody at all times. Trade-offs include higher gas " +
          "costs, slippage on thin pairs, and no KYC — but also no " +
          "counterparty risk from exchange insolvency.",
      },
      {
        kind: "summary",
        body:
          "CEXs win on convenience and deep liquidity for major pairs. " +
          "DEXs win on custody, censorship-resistance, and access to " +
          "long-tail tokens before they hit mainstream listings. " +
          "Most active traders use both.",
        bullets: [
          "CEX: custodial, KYC, fiat on-ramp, high liquidity",
          "DEX: self-custody, permissionless, higher complexity",
        ],
      },
    ],
    quiz: {
      question: "Which of the following is a key advantage of a DEX over a CEX?",
      options: [
        "Lower transaction fees in all market conditions",
        "You retain custody of your funds throughout the trade",
        "Faster trade execution with no slippage",
        "Guaranteed fiat withdrawal to your bank account",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: fundamentals/mining-staking ----------------------------------
  {
    id: "fundamentals/mining-staking",
    trackId: "fundamentals",
    order: 8,
    title: "What is Mining / Staking?",
    steps: [
      {
        kind: "concept",
        body:
          "Mining (proof-of-work) is the process by which Bitcoin " +
          "validators — called miners — expend real-world energy to solve " +
          "a cryptographic puzzle, earning the right to append the next " +
          "block and collect the block reward. Security comes from the " +
          "sheer cost of the energy required to attack the network.",
      },
      {
        kind: "concept",
        body:
          "Staking (proof-of-stake) replaced mining on Ethereum in 2022. " +
          "Validators lock up (stake) ETH as collateral; they are selected " +
          "to propose and attest to blocks probabilistically. " +
          "Misbehaviour results in slashing — losing a portion of staked " +
          "ETH. Energy use is ~99.95% lower than proof-of-work.",
      },
      {
        kind: "summary",
        body:
          "Both mechanisms solve the same problem — achieving consensus " +
          "without a central authority — but with different trade-offs. " +
          "PoW favours hardware and energy; PoS favours capital. Neither " +
          "is objectively superior; the debate is ongoing in the " +
          "crypto-economics community.",
        bullets: [
          "PoW (Bitcoin): energy-intensive, hardware-based, battle-tested",
          "PoS (Ethereum): capital-intensive, energy-efficient, slashing risk",
        ],
      },
    ],
    quiz: {
      question: "What happens to an Ethereum validator that misbehaves under proof-of-stake?",
      options: [
        "Their account is permanently banned by the Ethereum Foundation",
        "A portion of their staked ETH is burned as a penalty (slashing)",
        "Their transaction history is publicly annotated as malicious",
        "Nothing — validators are anonymous and cannot be penalised",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: fundamentals/nfts --------------------------------------------
  {
    id: "fundamentals/nfts",
    trackId: "fundamentals",
    order: 9,
    title: "NFTs in 60 Seconds",
    steps: [
      {
        kind: "concept",
        body:
          "An NFT (Non-Fungible Token) is a blockchain record that " +
          "certifies ownership of a unique digital asset. Unlike ETH — " +
          "where every coin is identical — each NFT has a distinct token " +
          "ID. The ERC-721 standard on Ethereum is the canonical " +
          "implementation; ERC-1155 allows batches of both fungible and " +
          "non-fungible tokens.",
      },
      {
        kind: "example",
        body:
          "Use cases go well beyond profile-picture JPEGs: event tickets, " +
          "in-game item ownership, music royalty rights, real-estate title " +
          "deeds, and domain names (ENS) are all active NFT applications. " +
          "The NFT proves provenance and allows programmable royalties " +
          "to flow automatically to creators on every secondary sale.",
      },
      {
        kind: "summary",
        body:
          "NFTs solve the long-standing problem of digital scarcity and " +
          "verifiable provenance. The hype of 2021 obscured genuine " +
          "utility; the underlying primitive — on-chain unique ownership — " +
          "remains a powerful building block for web3 applications.",
        bullets: [
          "ERC-721: one token, unique ID, verifiable owner",
          "Royalties: programmable, paid automatically on resale",
          "Use cases: art, gaming, ticketing, identity, real-world assets",
        ],
      },
    ],
    quiz: {
      question: "What makes an NFT 'non-fungible'?",
      options: [
        "It cannot be transferred to another wallet once minted",
        "Each token has a unique identifier making it distinct from all others",
        "It is backed by a physical asset stored in a vault",
        "It can only be owned by one person globally at a time due to a registry lock",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: fundamentals/layer-1-vs-layer-2 ------------------------------
  {
    id: "fundamentals/layer-1-vs-layer-2",
    trackId: "fundamentals",
    order: 10,
    title: "Layer 1 vs Layer 2",
    steps: [
      {
        kind: "concept",
        body:
          "A Layer 1 (L1) is a base blockchain that handles its own " +
          "consensus and settlement — Bitcoin and Ethereum mainnet are " +
          "both L1s. Security is highest at L1, but throughput is " +
          "limited: Ethereum processes roughly 15-30 transactions per " +
          "second, which creates congestion and high gas fees at peak demand.",
      },
      {
        kind: "concept",
        body:
          "Layer 2 (L2) networks like Arbitrum, Optimism, and zkSync " +
          "process transactions off the main chain in batches, then post " +
          "compressed proofs back to Ethereum for final settlement. " +
          "This inherits Ethereum's security while achieving hundreds to " +
          "thousands of TPS at a fraction of the cost.",
        bullets: [
          "Optimistic rollups (Arbitrum, Optimism): assume validity, fraud proofs",
          "ZK rollups (zkSync, Starknet): cryptographic validity proofs",
          "Both settle to Ethereum — security is inherited, not re-created",
        ],
      },
      {
        kind: "summary",
        body:
          "L1 = the source of truth; L2 = where most users should actually " +
          "transact day-to-day. Bridging assets between layers takes " +
          "minutes to hours; always factor bridge time and fees into " +
          "your workflow.",
      },
    ],
    quiz: {
      question: "How does a Layer 2 rollup inherit Ethereum's security?",
      options: [
        "By running its own independent set of validators",
        "By posting transaction batches and proofs back to Ethereum for final settlement",
        "By mirroring Ethereum's full node set on a faster network",
        "By requiring all users to hold ETH as collateral for their L2 transactions",
      ],
      correctIndex: 1,
    },
  },

  // =========================================================================
  // MARKETS — 5 lessons
  // =========================================================================

  // ---- POLISHED: markets/volatility ----------------------------------------
  {
    id: "markets/volatility",
    trackId: "markets",
    order: 1,
    title: "Understanding Volatility",
    steps: [
      {
        kind: "concept",
        body:
          "Volatility measures how much an asset's price moves over a " +
          "given period, typically expressed as annualised standard " +
          "deviation of returns. The S&P 500 averages roughly 15-20% " +
          "annualised volatility. Bitcoin typically runs at 60-100% — " +
          "three to five times higher — and smaller-cap altcoins can " +
          "exceed 200%. A 10% single-day swing that would be front-page " +
          "news in equities is routine in crypto.",
      },
      {
        kind: "concept",
        body:
          "Several structural factors drive crypto's elevated volatility: " +
          "relatively small market capitalisation means large orders move " +
          "price significantly; markets trade 24 hours a day, 7 days a " +
          "week with no circuit breakers; price action is heavily " +
          "narrative-driven (one tweet can reprice an asset); and " +
          "institutional liquidity thins out rapidly beyond the top " +
          "10 assets, amplifying swings in the long tail.",
        bullets: [
          "Low float: a $10M buy can move a $100M cap coin 10%+",
          "24/7 markets: no overnight calm; news hits at any hour",
          "Narrative-driven: sentiment shifts faster than fundamentals",
          "Thin institutional depth: small-caps lack stabilising buyers",
        ],
      },
      {
        kind: "summary",
        body:
          "Volatility is neither inherently good nor bad — it is the " +
          "environment you operate in. It creates outsized upside " +
          "opportunities AND rapid, devastating drawdowns. The correct " +
          "response is not to avoid crypto but to size positions " +
          "proportionally: never allocate more than you can afford to " +
          "see drop 80% without changing your life or your plan.",
      },
    ],
    quiz: {
      question: "Why is crypto typically more volatile than US equities?",
      options: [
        "Crypto exchanges use different accounting standards that inflate price swings",
        "Regulators deliberately allow wider price bands to attract retail traders",
        "Smaller market caps, 24/7 trading, narrative-driven price discovery, and thin institutional liquidity combine to amplify moves",
        "Crypto assets have no intrinsic value, so any price is equally valid",
      ],
      correctIndex: 2,
    },
  },

  // ---- STUB: markets/liquidity ---------------------------------------------
  {
    id: "markets/liquidity",
    trackId: "markets",
    order: 2,
    title: "Liquidity and Slippage",
    steps: [
      {
        kind: "concept",
        body:
          "Liquidity describes how easily an asset can be bought or sold " +
          "without significantly moving its price. A liquid market has " +
          "deep order books with many buyers and sellers at each price " +
          "level; an illiquid market has thin books where even a moderate " +
          "order can shift price substantially.",
      },
      {
        kind: "concept",
        body:
          "Slippage is the difference between the price you expected and " +
          "the price you actually received, caused by your order consuming " +
          "liquidity across multiple price levels. A $100 swap on Uniswap " +
          "in a deep ETH/USDC pool might slip 0.01%; the same $100 in a " +
          "obscure memecoin pool might slip 5-15%.",
        bullets: [
          "Large orders in thin markets: always set a slippage tolerance",
          "DEX AMMs: price moves along a bonding curve as you trade",
          "Check liquidity depth before sizing into smaller-cap tokens",
        ],
      },
      {
        kind: "summary",
        body:
          "Liquidity determines your real cost of trading beyond the " +
          "stated fee. For major pairs on top venues, slippage is " +
          "negligible. For long-tail assets, it can silently erode " +
          "10% or more of your position before you even start.",
      },
    ],
    quiz: {
      question: "What causes slippage when executing a large trade?",
      options: [
        "Exchange servers rounding prices to the nearest cent",
        "Your order consuming liquidity across multiple price levels in a thin order book",
        "A mandatory delay imposed by regulators on large transactions",
        "The gas fee being deducted from the received token amount",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: markets/bid-ask -----------------------------------------------
  {
    id: "markets/bid-ask",
    trackId: "markets",
    order: 3,
    title: "Bid, Ask, Spread",
    steps: [
      {
        kind: "concept",
        body:
          "Every market has two prices at any moment: the bid — the " +
          "highest price a buyer is willing to pay — and the ask (or " +
          "offer) — the lowest price a seller will accept. The spread " +
          "is the gap between them; it represents the immediate cost " +
          "of executing a trade and is effectively the market-maker's fee.",
      },
      {
        kind: "example",
        body:
          "BTC bid: $62,450 / ask: $62,460 — the spread is $10. A market " +
          "order to buy instantly fills at $62,460 (the ask). A limit " +
          "order at $62,450 would sit in the book waiting for a seller " +
          "to hit it, potentially saving the spread but risking the trade " +
          "never executing if price moves away.",
      },
      {
        kind: "summary",
        body:
          "Market orders prioritise certainty of execution; limit orders " +
          "prioritise price control. Tight spreads on liquid assets like " +
          "BTC/USDT make market orders cheap. Wide spreads on illiquid " +
          "pairs make limit orders essential.",
        bullets: [
          "Market order: fills immediately at current ask/bid",
          "Limit order: fills only at your specified price or better",
          "Spread = hidden transaction cost on every market order",
        ],
      },
    ],
    quiz: {
      question: "You place a market order to buy ETH. At which price does it fill?",
      options: [
        "The mid-price between bid and ask",
        "The current bid price",
        "The current ask price",
        "The last traded price",
      ],
      correctIndex: 2,
    },
  },

  // ---- STUB: markets/market-cap -------------------------------------------
  {
    id: "markets/market-cap",
    trackId: "markets",
    order: 4,
    title: "Market Cap and Dominance",
    steps: [
      {
        kind: "concept",
        body:
          "Market capitalisation is calculated as circulating supply " +
          "multiplied by current price. It provides a size-adjusted " +
          "comparison between assets: a coin at $1 with 1 billion tokens " +
          "in circulation has the same market cap as a coin at $1,000 with " +
          "1 million tokens — both are $1 billion cap assets.",
      },
      {
        kind: "concept",
        body:
          "Bitcoin dominance is BTC's market cap as a percentage of the " +
          "total crypto market cap. Historically, rising dominance signals " +
          "risk-off sentiment — capital rotates into BTC as a relative " +
          "safe haven. Falling dominance often coincides with 'altcoin " +
          "season', when speculative capital flows into smaller assets.",
      },
      {
        kind: "summary",
        body:
          "Market cap is a useful but imperfect metric — it does not " +
          "account for locked or lost supply, or for the fact that the " +
          "last traded price does not reflect what price you'd get " +
          "liquidating the entire supply. Use it for rough relative " +
          "sizing, not precise valuation.",
      },
    ],
    quiz: {
      question:
        "If a token has 500 million circulating supply and a price of $2, what is its market cap?",
      options: ["$250 million", "$500 million", "$1 billion", "$2 billion"],
      correctIndex: 2,
    },
  },

  // ---- STUB: markets/cycles -----------------------------------------------
  {
    id: "markets/cycles",
    trackId: "markets",
    order: 5,
    title: "Bull and Bear Markets",
    steps: [
      {
        kind: "concept",
        body:
          "Crypto moves in broad multi-year cycles loosely correlated " +
          "with Bitcoin's halving schedule. Bull markets are characterised " +
          "by sustained price appreciation, euphoric media coverage, and " +
          "rapid retail inflows. Bear markets see 70-90% drawdowns from " +
          "peak, prolonged low volume, and project attrition.",
      },
      {
        kind: "concept",
        body:
          "Emotional cues are often contrarian signals: maximum optimism " +
          "('this time it's different — prices only go up') frequently " +
          "marks cycle tops; maximum despair ('crypto is dead') often " +
          "marks cycle bottoms. Tracking on-chain metrics like active " +
          "addresses, exchange inflows, and long-term holder behaviour " +
          "provides more signal than price alone.",
      },
      {
        kind: "summary",
        body:
          "In a bull market: take some profit, rebalance, avoid leverage. " +
          "In a bear market: dollar-cost average if conviction is high, " +
          "preserve capital, and use the time to learn. The most " +
          "dangerous position is being all-in at the top — or all-out " +
          "at the bottom.",
        bullets: [
          "Bull market: euphoria, high volume, rising prices",
          "Bear market: despair, low volume, -70-90% drawdowns",
          "Halving cycles loosely anchor multi-year rhythm",
        ],
      },
    ],
    quiz: {
      question: "Historically, what has BTC dominance rising typically signalled?",
      options: [
        "A bull market peak where altcoins are about to outperform",
        "Risk-off sentiment with capital rotating into Bitcoin as relative safety",
        "An imminent Bitcoin hard fork inflating the circulating supply",
        "Increased regulatory scrutiny on altcoins specifically",
      ],
      correctIndex: 1,
    },
  },

  // =========================================================================
  // SAFETY — 5 lessons
  // =========================================================================

  // ---- POLISHED: safety/phishing -------------------------------------------
  {
    id: "safety/phishing",
    trackId: "safety",
    order: 1,
    title: "Phishing Attacks",
    steps: [
      {
        kind: "concept",
        body:
          "Phishing in crypto takes forms that traditional cybersecurity " +
          "training does not prepare you for: fake wallet-connect prompts " +
          "on cloned DeFi sites, direct messages impersonating 'MetaMask " +
          "Support' or 'Binance Security', Google and Twitter ads for " +
          "fake protocol front-ends, and 'wallet sync' or 'verification' " +
          "flows that are designed to capture your seed phrase. The " +
          "asymmetry is brutal — one mistake typically results in every " +
          "asset in that wallet being drained within 60 seconds by " +
          "automated bots monitoring for incoming seed phrases.",
      },
      {
        kind: "example",
        body:
          "A user searches 'MetaMask support' on Twitter after a failed " +
          "transaction. A reply from an account with 200 followers and a " +
          "blue-border profile picture offers to help. The user DMs back. " +
          "They are sent a link to 'metamask-support-portal[.]com' — a " +
          "pixel-perfect clone of the MetaMask site, with a form asking " +
          "for their 12-word seed phrase to 'restore wallet connectivity'. " +
          "Within 90 seconds of submitting the form, all ETH and tokens " +
          "are transferred to a drainer address. The funds are " +
          "unrecoverable.",
      },
      {
        kind: "summary",
        body:
          "Three non-negotiable rules to internalise: (1) Your seed " +
          "phrase should never be typed into any website, app, browser " +
          "extension prompt, or DM — ever, under any circumstance. " +
          "(2) Bookmark official URLs for every protocol you use and " +
          "navigate exclusively from those bookmarks; never click links " +
          "in emails, DMs, or search ads. (3) Treat every unsolicited " +
          "DM offering help, airdrops, or urgent account action as " +
          "hostile by default. Legitimate protocols do not cold-contact " +
          "users to request credentials.",
        bullets: [
          "Never type your seed phrase anywhere — no exceptions",
          "Bookmark official sites; never click DM or ad links",
          "Unsolicited 'support' DMs are almost always phishing",
          "When in doubt, close the tab and go to your bookmark",
        ],
      },
    ],
    quiz: {
      question:
        "You receive a DM saying your wallet needs to sync and you'll lose funds if you don't act within 24 hours. What should you do?",
      options: [
        "Follow the link immediately — the time pressure means it's urgent",
        "Reply asking for the official support ticket number before proceeding",
        "Ignore the DM entirely and navigate only from your own bookmarked official URLs",
        "Enter your seed phrase on the linked site but change your password afterwards",
      ],
      correctIndex: 2,
    },
  },

  // ---- STUB: safety/2fa ---------------------------------------------------
  {
    id: "safety/2fa",
    trackId: "safety",
    order: 2,
    title: "Two-Factor Authentication",
    steps: [
      {
        kind: "concept",
        body:
          "Two-factor authentication (2FA) adds a second layer of proof " +
          "beyond your password — something you know plus something you " +
          "have. SMS-based 2FA sends a code to your phone number, but is " +
          "vulnerable to SIM-swap attacks where a criminal convinces your " +
          "carrier to redirect your number. TOTP authenticator apps " +
          "(Google Authenticator, Authy) generate codes locally and " +
          "cannot be intercepted via SIM-swap.",
      },
      {
        kind: "concept",
        body:
          "For crypto exchange accounts, use a TOTP authenticator app " +
          "as a minimum — not SMS. For maximum security, hardware keys " +
          "(YubiKey) provide phishing-resistant 2FA that cannot be " +
          "replayed on a fake site. Store your TOTP backup codes offline " +
          "in the same secure location as your seed phrase.",
        bullets: [
          "SMS 2FA: better than nothing, vulnerable to SIM-swap",
          "TOTP app: strong, free, not SIM-swappable",
          "Hardware key: strongest, phishing-resistant, ~$50",
        ],
      },
      {
        kind: "summary",
        body:
          "Enabling 2FA is the single highest-ROI security action you " +
          "can take on any exchange account. Thirty seconds of setup " +
          "prevents the majority of account takeover attacks — but only " +
          "if you use an authenticator app, not SMS.",
      },
    ],
    quiz: {
      question: "Why is a TOTP authenticator app safer than SMS 2FA for exchange accounts?",
      options: [
        "TOTP codes are longer and harder to guess by brute force",
        "TOTP codes are generated locally and cannot be intercepted via a SIM-swap attack",
        "Authenticator apps encrypt your password before sending it to the exchange",
        "SMS 2FA is banned by most crypto exchanges due to regulation",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: safety/cold-storage ------------------------------------------
  {
    id: "safety/cold-storage",
    trackId: "safety",
    order: 3,
    title: "Cold Storage 101",
    steps: [
      {
        kind: "concept",
        body:
          "Cold storage means keeping private keys on a device that is " +
          "never connected to the internet, eliminating the largest " +
          "attack surface for hackers. Hardware wallets like Ledger and " +
          "Trezor store keys in a secure element chip; transactions are " +
          "signed on the device and only the signed transaction is " +
          "broadcast online — your key never touches the internet.",
      },
      {
        kind: "concept",
        body:
          "The general rule of thumb: any crypto holding worth more than " +
          "you'd leave in cash in your coat pocket warrants a hardware " +
          "wallet. At the extreme end, air-gapped computers (permanently " +
          "offline) can sign transactions via QR code. The inconvenience " +
          "is the point — friction keeps you and attackers from moving " +
          "funds impulsively.",
      },
      {
        kind: "summary",
        body:
          "Cold storage does not protect against seed phrase exposure — " +
          "if someone photographs your seed phrase backup, your hardware " +
          "wallet is irrelevant. Physical security of the seed phrase " +
          "matters as much as device security.",
        bullets: [
          "Hardware wallet: ~$50-150, eliminates remote attack surface",
          "Air-gapped device: maximum security, maximum friction",
          "Still requires secure physical seed phrase storage",
        ],
      },
    ],
    quiz: {
      question: "What is the primary security advantage of a hardware wallet?",
      options: [
        "It encrypts your transactions with a faster algorithm than software wallets",
        "Private keys are stored in an isolated secure element and never exposed to the internet",
        "The manufacturer holds a backup key in case you lose access",
        "It prevents phishing by blocking fake websites at the network level",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: safety/rug-pulls ---------------------------------------------
  {
    id: "safety/rug-pulls",
    trackId: "safety",
    order: 4,
    title: "Rug Pulls and Red Flags",
    steps: [
      {
        kind: "concept",
        body:
          "A rug pull occurs when project founders abandon a project and " +
          "drain its liquidity pool or treasury, leaving investors with " +
          "worthless tokens. They are especially common in DeFi and " +
          "memecoins. Common red flags: anonymous team with no track " +
          "record, no independent code audit, liquidity that is not " +
          "time-locked, and astronomical APY promises with no clear " +
          "revenue source.",
        bullets: [
          "Anonymous team: not always bad, but raises the stakes of due diligence",
          "Unlocked liquidity: founders can drain the pool at any time",
          "No audit: unreviewed code can contain intentional backdoors",
          "Unsustainable APY: high yield paid from new investor deposits is a Ponzi structure",
        ],
      },
      {
        kind: "example",
        body:
          "A new DeFi token launches with 10,000% APY 'farming' rewards. " +
          "The contract has a hidden function allowing the deployer to " +
          "mint unlimited tokens. After two weeks and $5M TVL, the " +
          "deployer mints 100× the supply, swaps it all for ETH through " +
          "the liquidity pool, and withdraws. The token price drops 99% " +
          "in minutes. This sequence takes less than a single on-chain " +
          "transaction to execute.",
      },
      {
        kind: "summary",
        body:
          "Before investing in any DeFi project: check if liquidity is " +
          "locked (via Unicrypt or similar), read the audit report from a " +
          "reputable firm, verify the team's on-chain history, and ask " +
          "whether the yield model is sustainable. If something promises " +
          "returns that seem impossible, they almost certainly are.",
      },
    ],
    quiz: {
      question:
        "Which of the following is the strongest indicator that a DeFi project may be a rug pull?",
      options: [
        "The project has not yet launched a mobile app",
        "Liquidity is not time-locked and can be withdrawn by the deployer at any time",
        "The token is not listed on Coinbase yet",
        "The project's whitepaper is longer than 20 pages",
      ],
      correctIndex: 1,
    },
  },

  // ---- STUB: safety/seed-phrase -------------------------------------------
  {
    id: "safety/seed-phrase",
    trackId: "safety",
    order: 5,
    title: "Seed Phrase Hygiene",
    steps: [
      {
        kind: "concept",
        body:
          "Your seed phrase (12 or 24 BIP-39 words) is the master key " +
          "to every account in your wallet. Anyone who obtains it can " +
          "instantly import your wallet and drain all funds on every " +
          "chain it controls. It must never exist in digital form: no " +
          "photos, no notes apps, no cloud storage, no password managers, " +
          "no emails — not even in a 'private' document.",
      },
      {
        kind: "concept",
        body:
          "Best practice: write the seed phrase on paper immediately " +
          "upon wallet creation, then transfer to a fireproof metal " +
          "backup plate (Cryptosteel, Bilodl). Store copies in two " +
          "geographically separate secure locations — a home safe and " +
          "a bank safety deposit box is a common approach. Treat it " +
          "with the same care as a physical bearer bond worth your " +
          "entire portfolio.",
        bullets: [
          "Paper: immediate backup, vulnerable to fire/water",
          "Metal plate: fireproof, waterproof, long-term durable",
          "Two locations: protects against single-location disaster",
          "Never digital: no exceptions, ever",
        ],
      },
      {
        kind: "summary",
        body:
          "The seed phrase is the final backstop of crypto self-custody. " +
          "Get its storage right before you fund the wallet — retrofitting " +
          "good hygiene after the fact is human nature, but one flood or " +
          "fire between setup and 'I'll do it properly later' is all it " +
          "takes to lose everything.",
      },
    ],
    quiz: {
      question: "Where is it acceptable to store a copy of your seed phrase?",
      options: [
        "In a password manager protected by a strong master password",
        "In a private Google Drive folder with two-factor authentication enabled",
        "On a fireproof metal backup plate stored in a physically secure location",
        "As an encrypted note in your phone's Notes app",
      ],
      correctIndex: 2,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------------------

const LESSON_ID_SET = new Set<string>(LESSONS.map((l) => l.id));

export function getLesson(id: LessonId): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function getTrack(id: TrackId): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}

export function lessonsByTrack(trackId: TrackId): Lesson[] {
  return LESSONS.filter((l) => l.trackId === trackId).sort((a, b) => a.order - b.order);
}

export function isLessonId(s: string): s is LessonId {
  return LESSON_ID_SET.has(s);
}
