# Multisig Authority Setup — Operations Runbook

## Overview

The vesting program uses single-key EOAs for upgrade authority, cancel authority, and pause authority. Per `SECURITY.md` §4.1, this is rated **HIGH severity**. This runbook documents the procedure for transferring all program authorities to a Squads v4 multisig before mainnet deployment.

| Authority | Current Holder | Target |
|-----------|---------------|--------|
| BPF Upgrade | `GPfHeZtBna1rJmwam1yCcREhYnLcxWhBmUdDoVuL5Es6` | Squads v4 multisig |
| Cancel | Campaign creator (set at creation) | Squads v4 multisig |
| Pause | Campaign creator (set at creation) | Squads v4 multisig |

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

## Prerequisites

- Solana CLI installed and configured
- Squads v4 CLI (`squads-multisig-cli`) or web UI at [app.squads.so](https://app.squads.so)
- 3 authority keypairs (recommended for 2-of-3 threshold)
- Devnet SOL for testing: `solana airdrop 2 <KEYPAIR> --url devnet`
- Production program source checked out at the deployment commit

## Step 1 — Create Squads v4 Multisig

### Via CLI

```bash
# Install Squads CLI if not present
npm install -g @sqds/cli

# Create a 2-of-3 multisig on devnet
sqds multisig create \
  --keypair <creator_keypair> \
  --members <member1_pubkey>,<member2_pubkey>,<member3_pubkey> \
  --threshold 2 \
  --url devnet

# Note the multisig PDA address from the output
```

### Via Web UI

1. Navigate to [app.squads.so](https://app.squads.so)
2. Connect wallet
3. Create new Squad with 2-of-3 threshold
4. Add 3 members
5. Note the Squad address (this is the multisig PDA)

## Step 2 — Transfer Program Upgrade Authority

```bash
# Verify current authority
solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu --url devnet

# Transfer upgrade authority to multisig
solana program set-upgrade-authority \
  G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu \
  --new-authority <MULTISIG_PDA> \
  --url devnet \
  --keypair <current_authority_keypair>

# Verify transfer
solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu --url devnet
# Upgrade authority should now show <MULTISIG_PDA>
```

## Step 3 — Update cancel_authority and pause_authority

These are `Option<Pubkey>` fields stored on the `VestingTree` account, set at campaign creation time. No program code change is required — the program accepts any valid Pubkey.

### For new campaigns

Pass the multisig PDA as `cancel_authority` and `pause_authority` when calling `create_campaign` or `create_campaign_native`:

```typescript
// Transaction instruction: set cancel_authority to multisig
cancelAuthority: multisigPda;
```

### For existing campaigns

- The `cancel_authority` is set per-campaign and cannot be changed after creation
- Plan migration: let existing campaigns expire, create new campaigns with multisig authority

## Step 4 — Verify on Explorer

1. Open [solanaexplorer.com](https://solanaexplorer.com)
2. Search for program `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
3. Confirm upgrade authority shows the multisig PDA
4. For each active campaign, verify cancel/pause authority points to multisig

## Rollback Procedure

### Devnet

If something goes wrong during devnet testing:

```bash
# Redeploy with original keypair (devnet only)
solana program deploy target/deploy/vesting.so \
  --program-id <keypair.json> \
  --url devnet
```

### Mainnet

On mainnet, the multisig can propose a transaction to transfer authority back:

1. Create a proposal in Squads UI to call `solana program set-upgrade-authority` back to an EOA
2. 2-of-3 members approve the proposal
3. Execute the proposal

## Mainnet Checklist

- [ ] Squads v4 multisig created on mainnet (2-of-3 threshold)
- [ ] Multisig funded with SOL for transaction fees
- [ ] Upgrade authority transferred to multisig PDA
- [ ] Verified upgrade authority on Solana Explorer
- [ ] New campaigns use multisig as cancel/pause authority
- [ ] All 3 member keypairs stored securely (hardware wallet recommended)
- [ ] Recovery procedure documented and tested on devnet
