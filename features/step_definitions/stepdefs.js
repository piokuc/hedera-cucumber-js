const assert = require('assert');
const { BigNumber } = require('bignumber.js');
const { Given, When, Then, setDefaultTimeout } = require('@cucumber/cucumber');

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
require('dotenv').config({ path: '.env' });


class Account {
  constructor(accountId, privateKey) {
    this.id = accountId;
    this.privateKey = privateKey;
    this.publicKey = privateKey.publicKey;
  }
}


class AccountsManager {
  _initialised = false;

  constructor() {
    this.myAccountId = process.env.MY_ACCOUNT_ID;

    if (!this.myAccountId) {
      throw new Error("Environment variable MY_ACCOUNT_ID must be set to a Hedera Testnet account Id");
    }

    if (! process.env.MY_PRIVATE_KEY) {
      throw new Error("Environment variable MY_PRIVATE_KEY must be present");
    }

    this.myPrivateKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);

    this._accountByName = {}
    this._accountByName["admin"] = new Account(this.myAccountId, this.myPrivateKey);

    // Create our connection to the Hedera network
    // The Hedera JS SDK makes this really easy!
    this.client = Client.forTestnet();
    this.client.setOperator(this.myAccountId, this.myPrivateKey);
  }

  async _initialise() {
    if (this._initialised)
      return;
    this._initialised = true;
    try {
      await this.initAccount("treasury", 500);
      await this.initAccount("first", 10);
      await this.initAccount("second", 10);
      await this.initAccount("third", 10);
      await this.initAccount("fourth", 10);
    } catch (e) {
      this._initialised = false;
      console.log(`Failed to _initialise: ${e}`);
      throw e;
    }
  }

  async account(name) {
    await this._initialise();
    if (! (name in this._accountByName)) {
      throw new Error(`Account "${name}" does not exist`);
    }
    return this._accountByName[name];
  }

  async transfer(sourceAccount, targetAccount, hbarAmount) {
    const tx = await new TransferTransaction()
      .addHbarTransfer(sourceAccount.id, -hbarAmount)
      .addHbarTransfer(targetAccount.id, hbarAmount)
      .freezeWith(this.client)
      .sign(hbarAmount > 0 ? sourceAccount.privateKey : targetAccount.privateKey);
      const txSubmit = await tx.execute(this.client);
      const receipt = await txSubmit.getReceipt(this.client);
      console.log(`transfer HBAR: ${JSON.stringify(receipt)}`);
  }

  async initAccount(name, hbarBalance) {
    if (!this._initialised)
      await this._initialise();

    if (! (name in this._accountByName)) {
      this._accountByName[name] = await this._createAccount(hbarBalance);
      return;
    }
    const account = this._accountByName[name];
    const balance = await this.balance(account);
    if (balance === hbarBalance)
      return;
    await this.transfer(await this.account("admin"), account, hbarBalance - balance)
  }

  async _createAccount (initialBalance) {
    const accountPrivateKey = PrivateKey.generateED25519();
  
    const response = await new AccountCreateTransaction()
      .setInitialBalance(new Hbar(initialBalance))
      .setKey(accountPrivateKey)
      .execute(this.client);
  
    const receipt = await response.getReceipt(this.client);
    console.log(`_createAccount: ${JSON.stringify(receipt)}`);
    return new Account(receipt.accountId, accountPrivateKey);
 }

  async balance(account) {
    const id = account.id;
    const query = new AccountBalanceQuery()
      .setAccountId(id);
    const accountBalance = await query.execute(this.client);
    const accountBalanceHbar = accountBalance.hbars.toBigNumber().toNumber();
    return accountBalanceHbar;
  }
}


class TokenService {

  constructor(accountsManager) {
    this.accountsManager = accountsManager;
    this.testTokenId = null;
    this.tokenTransferTransaction = null;
  }

  client() {
    return this.accountsManager.client;
  }

  async queryTokenFunction(functionName, tokenId) {
      const query = new TokenInfoQuery()
          .setTokenId(tokenId);

      console.log(`Retrieving ${functionName}`);
      const body = await query.execute(this.client());

      const result = functionName === "name" ? body.name
                  : functionName === "symbol" ? body.symbol
                  : functionName === "totalSupply" ? body.totalSupply
                  : functionName === "decimals" ? body.decimals
                  : functionName === "adminKey" ? body.adminKey
                  : null;
      return result
  }

  async checkTokenHasName(tokenId, name) {
    const tokenName = await this.queryTokenFunction("name", tokenId);
    assert(name === tokenName, `Test token has name "${tokenName}", expected "${name}"`)
    return true;
  }

  async checkTokenHasSymbol(tokenId, symbol) {
    const tokenSymbol = await this.queryTokenFunction("symbol", tokenId);
    assert(symbol === tokenSymbol, `Test token has symbol "${tokenSymbol}", expected "${symbol}"`)
    return true;
  }

  async checkTokenHasDecimals(tokenId, decimals) {
    const tokenDecimals = await this.queryTokenFunction("decimals", tokenId);
    assert(decimals === tokenDecimals, `Test token has decimals "${tokenDecimals}", expected "${decimals}"`)
    return true;
  }

  async checkTokenAdminKey(tokenId, adminKey) {
    const tokenAdminKey = await this.queryTokenFunction("adminKey", tokenId);
    assert(adminKey.toString() === tokenAdminKey.toString(),
    `Test token has adminKey "${tokenAdminKey}", expected "${adminKey}"`)
    return true;
  }

  async checkTokenTotalSupply(tokenId, totalSupply) {
    const tokenTotalSupply = await this.queryTokenFunction("totalSupply", tokenId);
    assert(tokenTotalSupply.toInt() === totalSupply,
      `Total supply is ${tokenTotalSupply}, expected ${totalSupply}`
    );
  }

  async mintTokens(tokenId, amount) {
    await this.accountsManager._initialise();

    const initialSupply = await this.queryTokenFunction("totalSupply", tokenId);

    const transaction = new TokenMintTransaction()
          .setTokenId(tokenId)
          .setAmount(amount)
          .freezeWith(this.client());

    // Sign the transaction with the client, who is set as admin and treasury account
    const treasuryAccount = await this.accountsManager.account("treasury");
    const treasuryClient = Client.forTestnet();
    treasuryClient.setOperator(treasuryAccount.id, treasuryAccount.privateKey);
    const signTx = await transaction.sign(treasuryAccount.privateKey);

    // Submit the signed transaction to a Hedera network
    const txResponse = await signTx.execute(treasuryClient);

    // Request the receipt of the transaction
    const receipt = await txResponse.getReceipt(treasuryClient);

    // Get the transaction consensus status
    const transactionStatus = receipt.status.toString();

    console.log(`The mint transaction consensus status is ${transactionStatus}`);

    const finalSupply = await this.queryTokenFunction("totalSupply", tokenId);

    assert(finalSupply.equals(initialSupply.add(amount)),
      `Initial supply was ${initialSupply}, after minting ${amount} tokens`
      + ` final supply should be ${initialSupply.add(amount)}, was ${finalSupply}`);
  }

  async createTestToken(name, symbol, supply, fixedSupply) {
    await this.accountsManager._initialise();

    const adminAccount = await this.accountsManager.account("admin");
    const treasuryAccount = await this.accountsManager.account("treasury");
    assert(adminAccount);
    assert(treasuryAccount);

    // Create the transaction and freeze for manual signing
    const transaction = new TokenCreateTransaction()
        .setTokenName(name)
        .setTokenSymbol(symbol)
        .setTokenType(TokenType.FungibleCommon)
        .setTreasuryAccountId(treasuryAccount.id)
        .setInitialSupply(supply)
        .setAdminKey(adminAccount.publicKey)
        .setSupplyKey(adminAccount.publicKey);

    if (fixedSupply) {
      transaction
        .setMaxSupply(supply)
        .setSupplyType(TokenSupplyType.Finite);
    }

    transaction.freezeWith(this.client());

    // Sign the transaction with the client, who is set as admin and treasury account
    const signTx = await transaction.sign(treasuryAccount.privateKey);

    // Submit to a Hedera network
    const txResponse = await signTx.execute(this.client());

    // Get the receipt of the transaction
    const receipt = await txResponse.getReceipt(this.client());
    console.log(`Token create: ${receipt}`);

    // Get the token ID from the receipt
    const tokenId = receipt.tokenId;

    this.testTokenId = tokenId;

    console.log(`The new token ID is ${tokenId}`);

    const tokenName = await this.queryTokenFunction("name", tokenId);
    const tokenSymbol = await this.queryTokenFunction("symbol", tokenId);
    const tokenSupply = await this.queryTokenFunction("totalSupply", tokenId);
    console.log(`The total supply of the ${tokenName} token is ${tokenSupply} of ${tokenSymbol}`);

    // Create the query
    const balanceQuery = new AccountBalanceQuery()
        .setAccountId(adminAccount.id);

    // Sign with the client operator private key and submit to a Hedera network
    const tokenBalance = await balanceQuery.execute(this.client());
    const userBalance = tokenBalance.tokens.get(tokenId);
    console.log(`The balance of the user is: ${userBalance}`);
  }

  async queryTokenBalance(accountId, tokenId) {
      const balanceQuery = new AccountBalanceQuery()
          .setAccountId(accountId);

      const accountBalances = await balanceQuery.execute(this.client());
      return accountBalances.tokens.get(tokenId);
  }

  async createTokenTransferTransaction (sourceAccount, targetAccount, tokenId, amount) {
    const tokenTransferTx = await new TransferTransaction()
      .addTokenTransfer(tokenId, sourceAccount.id, -amount)
      .addTokenTransfer(tokenId, targetAccount.id, amount)
      .freezeWith(this.client())
      .sign(amount > 0 ? sourceAccount.privateKey : targetAccount.privateKey);
    return tokenTransferTx;
  }

  async submitTransaction(client, tokenTransferTx) {
    const tokenTransferSubmit = await tokenTransferTx.execute(client);
    const tokenTransferReceipt = await tokenTransferSubmit.getReceipt(client);
    return tokenTransferReceipt;
  }

  async associateAccountWithToken (tokenId, account) {
    const associateTx = await new TokenAssociateTransaction()
      .setAccountId(account.id)
      .setTokenIds([tokenId])
      .freezeWith(this.client())
      .sign(account.privateKey);

    const associateTxSubmit = await associateTx.execute(this.client());

    const receipt = await associateTxSubmit.getReceipt(this.client());

    console.log(`Token association with account: ${receipt.status}`);
  }

  async setTokenBalance(tokenId, account, balance) {
    let targetAccountBalance = await this.queryTokenBalance(account.id, tokenId);
    if (targetAccountBalance == null) {
      await this.associateAccountWithToken(tokenId, account);
      targetAccountBalance = 0;
    }

    if (balance === targetAccountBalance)
      return;

    const treasuryAccount = await this.accountsManager.account("treasury");
    await this.transferTokens(tokenId, balance - targetAccountBalance, account, treasuryAccount);
  }

  async transferTokens(tokenId, amount, targetAccount, treasuryAccount) {
    const tokenTransferTx = await new TransferTransaction()
      .addTokenTransfer(tokenId, treasuryAccount.id, -amount)
      .addTokenTransfer(tokenId, targetAccount.id, amount)
      .freezeWith(this.client())
      .sign(treasuryAccount.privateKey);

    const tokenTransferSubmit = await tokenTransferTx.execute(this.client());
    const receipt = await tokenTransferSubmit.getReceipt(this.client());
    console.log(`transfer tokens: ${receipt.status}`);
  }
}

class ConsensusService {

  constructor(accountsManager) {
    this.accountsManager = accountsManager;
    this.testTopicId = null;
    this.thresholdKey = null;
  }

  client() {
    return this.accountsManager.client;
  }

  async createTopic(memo, submitKey) {
      await this.accountsManager._initialise();
      const transactionId = await new TopicCreateTransaction()
        .setTopicMemo(memo)
        .setAdminKey(this.accountsManager.myPrivateKey.publicKey)
        .setSubmitKey(submitKey)
        .setAutoRenewAccountId(this.accountsManager.myAccountId)
        .execute(this.client());
      const receipt = await transactionId.getReceipt(this.client());
      console.log(`Topic create: ${JSON.stringify(receipt)}`);
      const topicId = receipt.topicId;
      console.log(`New topic ID is ${topicId.toString()}`);
      this.testTopicId = topicId;
  }

  async publishMessage(message, account) {
    const client = Client.forTestnet();
    client.setOperator(account.id, account.privateKey);

    // Submit the message to the topic
    const transactionId = await new TopicMessageSubmitTransaction()
      .setTopicId(this.testTopicId)
      .setMessage(message)
      .freezeWith(this.client());

    // Sign with the submit key
    const signTx = await transactionId.sign(account.privateKey);

    // Execute the transaction
    const txSubmit = await signTx.execute(this.client());
    const receipt = await txSubmit.getReceipt(this.client());
    console.log(`The status of message submission: ${receipt.status}`);
  }

  async receiveMessage() {
    // Wait 5 seconds between consensus topic creation and subscription
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Create a new topic message query that continuously polls the network for any new messages on the topic
    const subscriptionHandle = new TopicMessageQuery()
      .setTopicId(this.testTopicId)
      .setStartTime(0) // optional, this is unix timestamp (seconds since 1970-01-01T00:00:00Z)
      .subscribe(
        this.client(),
        (message) => {
          console.log(`Received message: ${message.contents}`);
          subscriptionHandle.unsubscribe();
        },
        (error) => {
          console.error(`Error receiving message: ${error}`);
          throw new Error(`Error receiving topic message: ${error}`);
        }
      );
  }

}


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
