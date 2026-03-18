export type SegmentIntel = {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  coins: CoinIntel[];
};

export type CoinIntel = {
  symbol: string;
  name: string;
  description: string;
  people?: { name: string; role: string; link?: string }[];
  links?: { label: string; url: string }[];
};

export const SEGMENT_KNOWLEDGE: SegmentIntel[] = [
  {
    id: 'ALL',
    name: 'Adaptive All-Market',
    icon: '🧠',
    tagline: 'Entire Market · Heatmap Router',
    description: 'The master intelligence protocol. Instead of committing to a single narrative, the Adaptive model scans the entire market heatmap every cycle. It mechanically identifies the 2 hottest segments receiving institutional volume and dynamically routes your capital exclusively to those top performers, dropping segments as they cool off.',
    coins: [
      {
        symbol: 'BTCUSDT',
        name: 'Bitcoin Macro',
        description: 'Bitcoin acts as the core macro-regime filter for the Adaptive bot. If Bitcoin is violently crashing, the Adaptive bot halts all altcoin deployments regardless of their individual segment heat.',
      }
    ]
  },
  {
    id: 'L1',
    name: 'Layer-1 Blockchains',
    icon: '🔵',
    tagline: 'Base Infrastructure · Highest Liquidity',
    description: 'Layer-1 networks are the foundational infrastructure of crypto. They settle transactions and provide the security layer for decentralized applications. These assets typically have the highest liquidity and are favored by institutional capital seeking lower volatility with steady beta.',
    coins: [
      {
        symbol: 'BTCUSDT',
        name: 'Bitcoin',
        description: 'The premier digital store of value and foundational asset of crypto. Often acts as an index for the entire market.',
      },
      {
        symbol: 'ETHUSDT',
        name: 'Ethereum',
        description: 'The leading smart contract platform and settlement layer for decentralized finance and NFTs.',
        people: [{ name: 'Vitalik Buterin', role: 'Co-Founder', link: 'https://twitter.com/VitalikButerin' }]
      },
      {
        symbol: 'SOLUSDT',
        name: 'Solana',
        description: 'A high-performance monolithic blockchain optimized for fast speeds and ultra-low fees. Highly favored for high-frequency trading and retail memecoin activity.',
        people: [{ name: 'Anatoly Yakovenko', role: 'Co-Founder', link: 'https://twitter.com/aeyakovenko' }]
      }
    ]
  },
  {
    id: 'L2',
    name: 'Layer-2 Scalability',
    icon: '🟣',
    tagline: 'Rollups · Execution Layers',
    description: 'Layer-2 protocols bundle transactions off the main Ethereum chain to drastically reduce fees and increase speed. They represent high-beta exposure to Ethereum, often outperforming ETH during bullish market expansion phases.',
    coins: [
      {
        symbol: 'ARBUSDT',
        name: 'Arbitrum',
        description: 'The leading Optimistic Rollup on Ethereum by Total Value Locked (TVL), known for its dominant DeFi ecosystem.',
        links: [{ label: 'Website', url: 'https://arbitrum.io' }]
      },
      {
        symbol: 'OPUSDT',
        name: 'Optimism',
        description: 'A major Layer-2 powering the "Superchain" vision, heavily utilized by Coinbase\'s Base network.',
        links: [{ label: 'Website', url: 'https://optimism.io' }]
      }
    ]
  },
  {
    id: 'AI',
    name: 'Artificial Intelligence',
    icon: '🤖',
    tagline: 'Decentralized Compute · Autonomous Agents',
    description: 'The intersection of crypto and AI. These protocols provide distributed GPU networks, decentralized machine learning resources, and frameworks for autonomous AI agents that transact on-chain.',
    coins: [
      {
        symbol: 'TAOUSDT',
        name: 'Bittensor',
        description: 'An open-source protocol that powers a decentralized, blockchain-based machine learning network.',
      },
      {
        symbol: 'FETUSDT',
        name: 'Fetch.ai / ASI',
        description: 'A blockchain platform for developing autonomous economic agents that automate business tasks and data sharing.',
        people: [{ name: 'Humayun Sheikh', role: 'CEO', link: 'https://twitter.com/HMsheikh4' }],
        links: [{ label: 'Website', url: 'https://fetch.ai' }]
      },
      {
        symbol: 'WLDUSDT',
        name: 'Worldcoin',
        description: 'A digital identification platform aiming to provide biometric "Proof of Personhood" in an AI-dominated internet.',
        people: [{ name: 'Sam Altman', role: 'Co-Founder', link: 'https://twitter.com/sama' }]
      }
    ]
  },
  {
    id: 'Meme',
    name: 'Meme Tokens',
    icon: '🐸',
    tagline: 'Retail Attention · Hyper-Volatility',
    description: 'Attention-driven assets with virtually no fundamentals but extreme liquidity and retail mindshare. These tokens serve as leveraged bets on primary networks (e.g., trading WIF as a leveraged bet on Solana network activity).',
    coins: [
      {
        symbol: 'DOGEUSDT',
        name: 'Dogecoin',
        description: 'The original memecoin. Driven by immense retail nostalgia and frequent endorsements from prominent figures.',
        people: [{ name: 'Elon Musk', role: 'Advocate', link: 'https://twitter.com/elonmusk' }]
      },
      {
        symbol: 'PEPEUSDT',
        name: 'Pepe',
        description: 'A deflationary memecoin launched on Ethereum referencing the Pepe the Frog internet meme.',
      },
      {
        symbol: 'WIFUSDT',
        name: 'Dogwifhat',
        description: 'The leading memecoin on the Solana network, known for its strong community-driven momentum.',
      }
    ]
  },
  {
    id: 'DeFi',
    name: 'Decentralized Finance',
    icon: '🌊',
    tagline: 'DEXs · Lending · On-chain Primitives',
    description: 'Protocols facilitating trustless financial operations without intermediaries. Includes Automated Market Makers (AMMs), money markets (lending/borrowing), and yield aggregators.',
    coins: [
      {
        symbol: 'UNIUSDT',
        name: 'Uniswap',
        description: 'The dominant decentralized exchange (DEX) on Ethereum using an automated liquidity protocol.',
        people: [{ name: 'Hayden Adams', role: 'Founder', link: 'https://twitter.com/haydenzadams' }],
        links: [{ label: 'Website', url: 'https://uniswap.org' }]
      },
      {
        symbol: 'AAVEUSDT',
        name: 'Aave',
        description: 'A decentralized non-custodial liquidity protocol where users can participate as depositors or borrowers.',
        people: [{ name: 'Stani Kulechov', role: 'Founder', link: 'https://twitter.com/StaniKulechov' }]
      }
    ]
  },
  {
    id: 'RWA',
    name: 'Real World Assets',
    icon: '🏦',
    tagline: 'Tokenized Treasury · Private Credit',
    description: 'Protocols that bridge off-chain assets (like US Treasuries, real estate, and private credit) onto the blockchain to provide permissionless, high-yield capital velocity.',
    coins: [
      {
        symbol: 'ONDOUSDT',
        name: 'Ondo Finance',
        description: 'A protocol providing institutional-grade, blockchain-enabled investment products and services, primarily focused on tokenized treasuries.',
        links: [{ label: 'Website', url: 'https://ondo.finance' }]
      },
      {
        symbol: 'PENDLEUSDT',
        name: 'Pendle',
        description: 'A permissionless yield-trading protocol where users can execute various yield-management strategies.',
      }
    ]
  },
  {
    id: 'Gaming',
    name: 'Gaming & Metaverse',
    icon: '🎮',
    tagline: 'GameFi · Web3 Infrastructure',
    description: 'Tokens tied to blockchain gaming ecosystems and virtual worlds. Highly speculative assets that rally aggressively during consumer tech cycles.',
    coins: [
      {
        symbol: 'IMXUSDT',
        name: 'Immutable X',
        description: 'A leading Layer-2 scaling solution specifically designed for NFTs and Web3 games on Ethereum.',
        links: [{ label: 'Website', url: 'https://immutable.com' }]
      },
      {
        symbol: 'SANDUSDT',
        name: 'The Sandbox',
        description: 'A virtual world where players can build, own, and monetize their gaming experiences.',
      }
    ]
  },
  {
    id: 'DePIN',
    name: 'Decentralized Physical Infrastructure',
    icon: '📡',
    tagline: 'Hardware Networks · Sensors',
    description: 'Decentralized Physical Infrastructure Networks (DePIN) use crypto incentives to deploy hardware networks at scale—coordinating mapping cameras, wireless hotspots, and compute networks.',
    coins: [
      {
        symbol: 'RNDRUSDT',
        name: 'Render',
        description: 'A distributed GPU rendering network built on top of the Ethereum blockchain.',
        people: [{ name: 'Jules Urbach', role: 'Founder', link: 'https://twitter.com/JulesUrbach' }]
      },
      {
        symbol: 'HNTUSDT',
        name: 'Helium',
        description: 'A decentralized, open-source wireless network architecture utilizing IoT tokens to reward hotspot operators.',
      }
    ]
  }
];
