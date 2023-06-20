const assert = require('assert');
const { BigNumber } = require('bignumber.js');
const { Given, When, Then, setDefaultTimeout } = require('@cucumber/cucumber');
const { Account, AccountsManager } = require("./accounts.js");
const { TokenService } = require("./tokens.js");
const { ConsensusService } = require("./consensus.js");

// Set default Cucumber step timeout.
setDefaultTimeout(60 * 1000);

const {
    TopicCreateTransaction,
    TokenCreateTransaction,
    TokenMintTransaction,
    AccountCreateTransaction,
    TokenType,
    TokenInfoQuery,
    Client,
    AccountBalanceQuery,
    PrivateKey,
    Wallet,
    HbarUnit,
    Hbar,
    TokenSupplyType,
    TokenAssociateTransaction,
    TransferTransaction,
    StatusError,
    AccountId,
    TopicMessageSubmitTransaction,
    TopicMessageQuery,
    KeyList,
    AccountDeleteTransaction
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

Given('A first hedera account with more than {int} hbar and {int} HTT tokens',
  async function (minHbarAmount, httAmount) {
    await gs.initAccount("first", minHbarAmount + 1)
    await gs.token.setTokenBalance(gs.token.testTokenId, await gs.account("first"), httAmount);
  }
);

Given('a first account with more than {int} hbars', async function (minHbarAmount) {
  await gs.initAccount("first", minHbarAmount + 1)
});

Given('A first account with more than {int} hbars', async function (minHbarAmount) {
  await gs.initAccount("first", minHbarAmount + 1)
});

Given('A Hedera account with more than {int} hbar', async function (minHbarAmount) {
  await gs.initAccount("first", minHbarAmount + 1)
});

Given('A first hedera account with more than {int} hbar', async function (minHbarAmount) {
  await gs.initAccount("first", minHbarAmount + 1)
});

Given('The first account holds {int} HTT tokens', async function (httAmount) {
    const firstAccount = await gs.account("first");
    await gs.token.setTokenBalance(gs.token.testTokenId, firstAccount, httAmount);
});

When('A topic is created with the memo {string} with the first account as the submit key',
  async function (memo) {
    await gs.consensus.createTopic(memo, (await gs.account("first")).publicKey);
});

When('The message {string} is published to the topic', async function (message) {
  await gs.consensus.publishMessage(message, await gs.account("first"));
});

Then('The message is received by the topic and can be printed to the console', async function () {
  await gs.consensus.receiveMessage();
});

Given('A second account with more than {int} hbars', async function (minHbarAmount) {
  await gs.initAccount("second", minHbarAmount + 1)
});

Given('A {int} of {int} threshold key with the first and second account',
  async function (requiredSignatures, numberOfKeys) {
    assert(numberOfKeys === 2, "The way the step is defined currently requires number of keys to be 2 (first and second account)");
    assert(requiredSignatures == 1 || requiredSignatures == 2, "Currently requiredSignatures can only be 1 or 2");

    const publicKeys = [];
    publicKeys.push((await gs.account("first")).publicKey);
    publicKeys.push((await gs.account("second")).publicKey);

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

Given('A second Hedera account', async function () {
  // Initial HBAR balance not specified, let's assume it's 0.
  await gs.initAccount("second", 0)
});

Given('The second account holds {int} HTT tokens', async function (amount) {
  const secondAccount = await gs.account("second");
  await gs.token.setTokenBalance(gs.token.testTokenId, secondAccount, amount);
});

Then('The third account holds {int} HTT tokens', async function (amount) {
  const thirdAccount = await gs.account("third");
  const actualAmount = await gs.token.queryTokenBalance(thirdAccount.id, gs.token.testTokenId);
  assert(actualAmount == amount, `Third account holds ${actualAmount} HTT, expected ${amount}`)
});

Then('The fourth account holds {int} HTT tokens', async function (amount) {
  const fourthAccount = await gs.account("fourth");
  const actualAmount = await gs.token.queryTokenBalance(fourthAccount.id, gs.token.testTokenId);
  assert(actualAmount == amount, `Fourth account holds ${actualAmount} HTT, expected ${amount}`)
});

When('The first account creates a transaction to transfer {int} HTT tokens to the second account',
  async function (amount) {
    gs.token.tokenTransferTransaction = await gs.token.createTokenTransferTransaction(
      await gs.account("first"), await gs.account("second"), gs.token.testTokenId, amount
    )
});

When('The first account submits the transaction', async function () {
  const client = Client.forTestnet();
  const firstAccount = await gs.account("first");
  client.setOperator(firstAccount.id, firstAccount.privateKey);

  await gs.token.tokenTransferTransaction.sign(firstAccount.privateKey)
  const submit = await gs.token.submitTransaction(client, gs.token.tokenTransferTransaction); 
});

When('The second account creates a transaction to transfer {int} HTT tokens to the first account', async function (amount) {
    gs.token.tokenTransferTransaction = await gs.token.createTokenTransferTransaction(
      await gs.account("second"), await gs.account("first"), gs.token.testTokenId, amount
    )
});

Then('The first account has paid for the transaction fee', async function () {
  // TODO
});

Given('A second Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await gs.initAccount("second", hbarAmount);
    await gs.token.setTokenBalance(gs.token.testTokenId, await gs.account("second"), httAmount);
});

Given('A third Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await gs.initAccount("third", hbarAmount);
    await gs.token.setTokenBalance(gs.token.testTokenId, await gs.account("third"), httAmount);
});

Given('A fourth Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await gs.initAccount("fourth", hbarAmount);
    await gs.token.setTokenBalance(gs.token.testTokenId, await gs.account("fourth"), httAmount);
});

When('A transaction is created to transfer {int} HTT tokens out of the first and second account'
     +' and {int} HTT tokens into the third account'
     +' and {int} HTT tokens into the fourth account',
  async function (firstAndSecondOutflowAmount, thirdInflowAmount, fourthInflowAmount) {

    // We need to choose a single, specific node for the multiple signatures to work.
    const nodeId = AccountId.fromString("0.0.3");

    const [a1, a2, a3, a4] = await Promise.all(
      ["first", "second", "third", "fourth"]
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
