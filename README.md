# Mancer Vesting

Solana token-distribution protocol combining Merkle-tree compression with full vesting (cliff / linear / milestone), per-recipient clawback via root rotation, and a 7-day campaign-wide grace clawback.

Built by Team 7 (Mancer x Superteam Scholarship).

## Repo layout

```
mancer-vesting/
├── programs/vesting/   # Anchor program (Rust)              — owner: Lana
├── clients/ts/         # Off-chain Merkle tooling (TS)      — owner: Lana
├── apps/web/           # Frontend dApp                       — owner: Geral
├── Anchor.toml         # Anchor workspace
├── Cargo.toml          # Rust workspace
├── package.json        # pnpm workspaces root
└── pnpm-workspace.yaml
```

## Ownership

| Area                | Owner | Notes                                       |
| ------------------- | ----- | ------------------------------------------- |
| `programs/vesting/` | Lana  | Anchor program, instructions, state, math   |
| `clients/ts/`       | Lana  | Leaf encoder, Merkle builder, proof helpers |
| `apps/web/`         | Geral | Frontend stack, wallet adapter, UX          |
| Root configs, CI    | Joint | Workspace files, GitHub Actions             |

## Prerequisites

Install in this order:

### 1. Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
```

### 2. Solana CLI (≥ 2.1)

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

After install, add to PATH as instructed, then verify:

```bash
solana --version
```

### 3. Anchor CLI (1.0.0)

Requires Rust installed first:

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 1.0.0
avm use 1.0.0
anchor --version
```

### 4. Node (≥ 20.10) and pnpm (≥ 10)

Install Node via [nvm](https://github.com/nvm-sh/nvm) or [official installer](https://nodejs.org/), then:

```bash
node --version          # must be ≥ 20.10
npm install -g pnpm
pnpm --version          # must be ≥ 10
```

### 5. Solana keypair (for devnet deploy)

```bash
solana-keygen new       # skip if you already have ~/.config/solana/id.json
solana config set -u devnet
solana airdrop 2        # fund your devnet wallet
```

## Quickstart

```bash
git clone https://github.com/Ah-Riz/mancerxsuperteam-token-vesting.git
cd mancerxsuperteam-token-vesting

pnpm install
anchor build
anchor test
```

### Devnet deploy

```bash
solana config set -u devnet
anchor build
anchor deploy --provider.cluster devnet
```

## Build spec

The full backend build brief (instructions, account layouts, math primitives, test scenarios) lives in `../week3/OPENCLAW_BRIEF.md` in the parent research repo.

## License

MIT — see `LICENSE`.
