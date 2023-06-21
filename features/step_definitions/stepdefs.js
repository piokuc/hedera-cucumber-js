const assert = require('assert');
const { BigNumber } = require('bignumber.js');
const { Given, When, Then, setDefaultTimeout } = require('@cucumber/cucumber');
const { Account, AccountsManager } = require("./accounts.js");
const { TokenService } = require("./tokens.js");
const { ConsensusService } = require("./consensus.js");

// Set default Cucumber step timeout.
setDefaultTimeout(60 * 1000);

const {
    Client,
    TransferTransaction,
    AccountId,
    KeyList,
} = require("@hashgraph/sdk");


class GlobalState extends AccountsManager {

  constructor() {
    super();

    this.token = new TokenService(this);
    this.consensus = new ConsensusService(this);
  }

}

const gs = new GlobalState();

/////////////////////////////////////////////////////////////////////
////////////////////// Step definitions /////////////////////////////
/////////////////////////////////////////////////////////////////////

Given('A/a {word} hedera account with more than {int} hbar and {int} HTT tokens',
  async function (accountName, minHbarAmount, httAmount) {
    await gs.initAccount(accountName, minHbarAmount + 1)
    await gs.token.setTokenBalance(gs.token.testTokenId, await gs.account(accountName), httAmount);
  }
);

Given('A/a {word} account with more than {int} hbar(s)', async function (accountName, minHbarAmount) {
  await gs.initAccount(accountName, minHbarAmount + 1)
});

Given('A/a {word} hedera account with more than {int} hbar(s)', async function (accountName, minHbarAmount) {
  await gs.initAccount(accountName, minHbarAmount + 1)
});

Given('A {word} Hedera account with {int} hbar(s) and {int} HTT token(s)',
  async function (accountName, hbarAmount, httAmount) {
    await gs.initAccount(accountName, hbarAmount);
    await gs.token.setTokenBalance(gs.token.testTokenId, await gs.account(accountName), httAmount);
});

Given('A {word} Hedera account', async function (accountName) {
  // Initial HBAR balance not specified, let's assume it's 0.
  await gs.initAccount(accountName, 0)
});


Given('The {word} account holds {int} HTT tokens', async function (accountName, httAmount) {
    const account = await gs.account(accountName);
    await gs.token.setTokenBalance(gs.token.testTokenId, account, httAmount);
});

When('A topic is created with the memo {string} with the {word} account as the submit key',
  async function (memo, accountName) {
    await gs.consensus.createTopic(memo, (await gs.account(accountName)).publicKey);
});

When('The message {string} is published to the topic', async function (message) {
  await gs.consensus.publishMessage(message, await gs.account("first"));
});

Then('The message is received by the topic and can be printed to the console', async function () {
  await gs.consensus.receiveMessage();
});

Given('A {int} of {int} threshold key with the {word} and {word} account',
  async function (requiredSignatures, numberOfKeys, firstAccountName, secondAccountName) {
    assert(numberOfKeys === 2, "The way the step is defined currently requires number of keys to be 2 (first and second account)");
    assert(requiredSignatures == 1 || requiredSignatures == 2, "Currently requiredSignatures can only be 1 or 2");

    const publicKeys = [];
    publicKeys.push((await gs.account(firstAccountName)).publicKey);
    publicKeys.push((await gs.account(secondAccountName)).publicKey);

    gs.thresholdKey = new KeyList(publicKeys, requiredSignatures);
    console.log(`threshold key: ${gs.thresholdKey}`);
});

When('A topic is created with the memo {string} with the threshold key as the submit key', async function (memo) {
  await gs.consensus.createTopic(memo, gs.thresholdKey);
});

When('I create a token named Test Token \\(HTT)', async function () {
  await gs.token.createTestToken("Test Token", 'HTT', 1000, false);
});

Given('A token named Test Token \\(HTT) with {int} tokens',
  async function (tokenSupply) {
    return await gs.token.createTestToken("Test Token", 'HTT', tokenSupply, false);
});

When('I create a fixed supply token named Test Token \\(HTT) with {int} tokens',
  async function (tokenSupply) {
    return await gs.token.createTestToken("Test Token", 'HTT', tokenSupply, true);
});

Then('The token has the name {string}', async function (name) {
  return await gs.token.checkTokenHasName(gs.token.testTokenId, name);
});

Then('The token has the symbol {string}', async function (symbol) {
  return await gs.token.checkTokenHasSymbol(gs.token.testTokenId, symbol);
});

Then('The token has {int} decimals', async function (decimals) {
  return await gs.token.checkTokenHasDecimals(gs.token.testTokenId, decimals);
});

Then('The token is owned by the account', async function () {
  const adminAccount = await gs.account("admin");
  await gs.token.checkTokenAdminKey(gs.token.testTokenId, adminAccount.publicKey);
});

Then('An attempt to mint {int} additional tokens succeeds', async function (tokenAmount) {
  await gs.token.mintTokens(gs.token.testTokenId, tokenAmount);
});

Then('The total supply of the token is {int}', async function (totalSupply) {
  await gs.token.checkTokenTotalSupply(gs.token.testTokenId, totalSupply);
});

Then('An attempt to mint tokens fails', async function () {
  const initialSupply = await gs.token.queryTokenFunction("totalSupply", gs.token.testTokenId);
  try {
    await gs.token.mintTokens(gs.token.testTokenId, 10000);
    throw new Error("Should throw TOKEN_MAX_SUPPLY_REACHED");
  } catch (error) {
    // OK, exception expected.
    console.log(`error minting token: ${JSON.stringify(error)}`);
  }
  await gs.token.checkTokenTotalSupply(gs.token.testTokenId, initialSupply.toInt());
});

Then('The {word} account should hold {int} HTT tokens', async function (accountName, httAmount) {
  const account = await gs.account(accountName);
  const actualAmount = await gs.token.queryTokenBalance(account.id, gs.token.testTokenId);
  assert(actualAmount == httAmount, `${accountName} account holds ${actualAmount} HTT, expected ${httAmount}`)
});

When('The {word} account creates a transaction to transfer {int} HTT tokens to the {word} account',
  async function (firstAccountName, amount, secondAccountName) {
    gs.token.tokenTransferTransaction = await gs.token.createTokenTransferTransaction(
      await gs.account(firstAccountName), await gs.account(secondAccountName), gs.token.testTokenId, amount
    )
});

When('The {word} account submits the transaction', async function (accountName) {
  const client = Client.forTestnet();
  const account = await gs.account(accountName);
  client.setOperator(account.id, account.privateKey);

  await gs.token.tokenTransferTransaction.sign(account.privateKey)
  const submit = await gs.token.submitTransaction(client, gs.token.tokenTransferTransaction); 
});

Then('The {word} account has paid for the transaction fee', async function (accountName) {
  // TODO
});

When('A transaction is created to transfer {int} HTT tokens out of the {word} and {word} account'
     +' and {int} HTT tokens into the {word} account'
     +' and {int} HTT tokens into the {word} account',
  async function (firstAndSecondOutflowAmount, firstAccountName, secondAccountName, thirdInflowAmount, thirdAccountName, fourthInflowAmount, fourthAccountName) {

    // We need to choose a single, specific node for the multiple signatures to work.
    const nodeId = AccountId.fromString("0.0.3");

    const [a1, a2, a3, a4] = await Promise.all(
      [firstAccountName, secondAccountName, thirdAccountName, fourthAccountName]
      .map(async (n) => await gs.account(n))
    );

    const tx = new TransferTransaction()
      .addTokenTransfer(gs.token.testTokenId, a1.id, -firstAndSecondOutflowAmount)
      .addTokenTransfer(gs.token.testTokenId, a2.id, -firstAndSecondOutflowAmount)
      .addTokenTransfer(gs.token.testTokenId, a3.id, thirdInflowAmount)
      .addTokenTransfer(gs.token.testTokenId, a4.id, fourthInflowAmount)
      .setNodeAccountIds([nodeId])
      .freezeWith(gs.client);

    tx.addSignature(a1.publicKey, a1.privateKey.signTransaction(tx));
    tx.addSignature(a2.publicKey, a2.privateKey.signTransaction(tx));
    tx.addSignature(a3.publicKey, a3.privateKey.signTransaction(tx));
    tx.addSignature(a4.publicKey, a4.privateKey.signTransaction(tx));
    
    gs.token.tokenTransferTransaction = tx;
});
