# Velthoryn User Guide

## Introduction

Velthoryn helps you lock and release tokens in a controlled way.

You can use it to:

- create token vesting for one person
- create token vesting for multiple recipients
- release tokens over time
- release tokens after a milestone
- let recipients claim tokens when they become available

There are two main roles in Velthoryn:

- **Sender**: the wallet that creates and funds the vesting
- **Recipient**: the wallet that receives and claims the tokens

---

## Vesting Types

### Cliff

All tokens unlock at one specific time.

Example:

- 100 tokens
- unlock on June 1
- before June 1: nothing can be claimed
- on June 1: all 100 tokens can be claimed

### Linear

Tokens unlock gradually over time.

Example:

- 100 tokens
- vesting starts on June 1
- vesting ends on July 1
- the recipient can claim a portion over time

### Milestone

Tokens unlock only after:

1. the required time is reached
2. the sender releases the milestone

This is useful when token release depends on progress or deliverables.

---

## Stream vs Campaign

### Stream

Use a stream when you want to send tokens to **one recipient**.

### Campaign

Use a campaign when you want to send tokens to **multiple recipients**.

Campaigns are usually created with CSV or with multiple entries in the form.

---

## Before You Start

Make sure:

1. your wallet is connected
2. you are on **Solana Devnet**
3. you have enough SOL for network fees
4. you have enough token balance to fund the vesting

This guide assumes you are testing on **Solana Devnet**, not Mainnet.

Before creating or claiming a vesting stream, make sure your wallet has test funds.

### Get Devnet SOL

You need SOL on Devnet to:

- pay network fees
- create token accounts
- fund transactions

Recommended links:

- Solana Devnet Faucet: https://faucet.solana.com/
- Solana Devnet SOL guide: https://solana.com/developers/guides/getstarted/solana-token-airdrop-and-faucets

Suggested user flow:

1. open the faucet link
2. paste your wallet address
3. request Devnet SOL
4. wait for the wallet balance to refresh
5. return to Velthoryn after the balance appears

If one faucet is rate-limited, wait and try again later.

### Get a Devnet Token

To create or fund a vesting, the sender wallet must also have the token being used in the stream or campaign.

There are two common cases:

#### Case 1: The project already has a Devnet test token

If your team already uses a specific Devnet token mint, such as a project test token or a Devnet USDT-style token, you need:

1. the correct mint address
2. the token sent to the sender wallet before testing

In this case, ask the project owner, backend team, or token owner to send test tokens to your wallet first.

Important note:

- there is usually **no single public faucet for generic Devnet USDT**
- if your testing flow specifically uses a Devnet USDT mint, that token usually needs to come from your project/team setup

#### Case 2: You are using a public Devnet stablecoin faucet

Some stablecoin issuers provide Devnet faucets for their own test tokens.

Examples listed by Solana:

- Circle Faucet (USDC): https://faucet.circle.com/
- Paxos Faucet (PYUSD / USDG): https://faucet.paxos.com/
- Solana Developer Tools page: https://solana.com/docs/payments/developer-tools

Suggested user flow:

1. open the faucet website
2. connect or enter the wallet address
3. request the Devnet test token
4. wait until the balance appears in the wallet
5. return to Velthoryn and select that mint

#### Case 3: You are using your own test token

If your team created its own Devnet SPL token, then:

1. use the project-provided mint address
2. make sure the sender wallet receives test tokens before creating vesting
3. verify the token appears in the wallet balance before continuing

After that, the token can be used in Velthoryn as long as:

- the mint address is correct
- the sender wallet has enough balance

### Important Note About Recipients

Recipients do **not** need to pre-fund the vesting token.

However, recipients may still need a small amount of **Devnet SOL** for:

- transaction fees
- creating an associated token account if required

---

## How To Create a Vesting

Choose the vesting type first, then follow the matching flow below.

### Cliff — Manual

Use this when:

- you have one recipient
- all tokens should unlock at one specific time

Steps:

1. Open **Create**
2. Choose **Cliff**
3. Stay in **Manual** mode
4. Select the token
5. Enter the recipient wallet address
6. Enter the token amount
7. Set the unlock time
8. Review the summary
9. Click **Create**

Suggested screenshots:

- Create page
- Cliff form
- Token selection
- Summary before create

### Cliff — CSV Campaign

Use this when:

- you want to create a cliff campaign for multiple recipients

Steps:

1. Open **Create**
2. Choose **Cliff**
3. Switch to **CSV Campaign**
4. Select the token
5. Paste or upload the CSV
6. Click **Parse & Validate**
7. Review the recipient preview
8. Click **Create & Fund Campaign**

Important notes:

- each wallet can only appear once in a cliff campaign
- each row should use the correct unlock time

Suggested screenshots:

- CSV upload area
- Parsed recipient preview
- Create & Fund button

### Linear — Manual

Use this when:

- you have one recipient
- tokens should unlock gradually over time

Steps:

1. Open **Create**
2. Choose **Linear**
3. Stay in **Manual** mode
4. Select the token
5. Enter the recipient wallet address
6. Enter the token amount
7. Set the start time
8. Set the cliff time if needed
9. Set the end time
10. Review the summary
11. Click **Create**

Suggested screenshots:

- Linear form
- Start / cliff / end time fields
- Summary before create

### Linear — CSV Campaign

Use this when:

- you want multiple recipients in one linear campaign

Steps:

1. Open **Create**
2. Choose **Linear**
3. Switch to **CSV Campaign**
4. Select the token
5. Paste or upload the CSV
6. Click **Parse & Validate**
7. Review the recipient preview
8. Click **Create & Fund Campaign**

Important notes:

- each wallet can only appear once in a linear campaign
- make sure start, cliff, and end times are correct before funding

Suggested screenshots:

- Linear CSV section
- Validation result
- Preview table

### Milestone — Manual

Use this when:

- you want one recipient
- tokens should unlock milestone by milestone

Steps:

1. Open **Create**
2. Choose **Milestone**
3. Stay in **Manual** mode
4. Select the token
5. Enter the beneficiary wallet address
6. Add one or more milestone entries
7. Set the amount for each milestone
8. Set the unlock time for each milestone
9. Review the summary
10. Click **Create**

Important notes:

- one milestone = one milestone stream
- multiple milestone entries may create a milestone campaign, depending on the flow
- recipients still need the sender to release milestones before claiming

Suggested screenshots:

- Milestone manual form
- Add Milestone button
- Multiple milestone entries

### Milestone — CSV Campaign

Use this when:

- you want to create a milestone campaign from CSV
- you want one or many beneficiaries with milestone-based release

Steps:

1. Open **Create**
2. Choose **Milestone**
3. Switch to **CSV Campaign**
4. Select the token
5. Paste or upload the CSV
6. Click **Parse & Validate**
7. Review the preview table
8. Confirm the milestone indexes
9. Click **Create & Fund Campaign**

Important notes:

- the same wallet may appear more than once in milestone CSV
- each repeated wallet must use a different milestone index
- if the same wallet uses the same milestone index twice, validation will fail

Suggested screenshots:

- Milestone CSV section
- Parsed preview with milestone index column
- Validation error example

---

## How To Claim Tokens

If you are a recipient:

1. connect the recipient wallet
2. open **My Campaigns**
3. open the vesting detail page
4. check the current status:
   - waiting
   - claimable
   - claimed
5. click **Claim** when tokens are available

If the tokens are not ready yet, the claim button may show:

- `Wait for cliff`
- `Wait for vesting`
- `Wait for milestone`

If the tokens are ready, the claim button will change to:

- `Claim ...`

---

## How To Read the Detail Page

On the vesting detail page, you may see:

- **Total Supply**: total tokens in the stream or campaign
- **Your Allocation**: the amount assigned to your wallet
- **You Claimed**: how much you already claimed
- **Vested**: how much has unlocked so far
- **Your Claimable**: how much you can claim right now

If you are the sender, you may also see sender actions like:

- Pause
- Unpause
- Cancel
- Release Milestone

---

## Pause and Unpause

The sender can pause a campaign or stream.

When paused:

- claiming is blocked
- recipients cannot claim until it is unpaused

When unpaused:

- claim becomes available again if tokens are unlocked

---

## Milestone Release

For milestone vesting:

- recipients cannot claim until the milestone is released
- the sender must release the milestone first

After release:

- the recipient can claim the milestone allocation

---

## Cancel Options

Velthoryn may show one of two cancel models.

### Instant Settle

Used for simple single-stream cases.

What it does:

- sends vested tokens to the recipient immediately
- returns unvested tokens to the sender immediately

### Grace Period

Used for campaign-style or multi-leaf cases.

What it does:

- freezes vesting at the current moment
- lets recipients claim what was already vested
- lets the sender withdraw unvested tokens after the grace period ends

---

## CSV Tips

Before creating a campaign from CSV:

1. check that each wallet address is correct
2. check that amounts are correct
3. check the vesting type
4. check time fields carefully
5. click **Parse & Validate** before creating

If the app shows a validation error:

- fix the CSV first
- then parse again

---

## Common Questions

## Why can’t I claim yet?

Possible reasons:

- the unlock time has not been reached
- the stream is paused
- the milestone has not been released
- you are using the wrong wallet

## Why does the app say “Wait” instead of “Claim”?

That means your tokens are not claimable yet.

Wait until:

- the cliff is reached
- enough linear vesting has passed
- the milestone is released

## Why does my wallet balance not update immediately?

Sometimes wallet extensions or devnet may refresh slowly.

If the transaction already succeeded:

- wait a few seconds
- refresh the page
- check the wallet again

## Why does a campaign show multiple recipients?

That means it is a campaign, not a single stream.

You can use the recipient list to see who is included.

---

## Best Practices

To avoid mistakes:

1. double-check wallet addresses before creating
2. use small test amounts first
3. use a fresh test campaign when trying a new flow
4. verify claim results with the recipient wallet
5. review CSV carefully before funding

---

## Suggested Screenshot Sections

If you want to turn this into a polished Word document for users, add screenshots for:

1. Cliff — Manual
2. Cliff — CSV Campaign
3. Linear — Manual
4. Linear — CSV Campaign
5. Milestone — Manual
6. Milestone — CSV Campaign
7. vesting detail page
8. claim button states
9. milestone release action
10. pause / cancel actions

---

## Final Summary

Velthoryn lets you:

- create vesting for one or many recipients
- release tokens by time or by milestone
- fund and manage token distribution
- let recipients claim tokens safely

If you are a sender:

- create, fund, and manage vesting

If you are a recipient:

- wait for tokens to unlock
- claim them when available
