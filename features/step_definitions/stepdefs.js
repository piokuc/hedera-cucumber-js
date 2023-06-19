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
    KeyList
} = require("@hashgraph/sdk");
require('dotenv').config({ path: '.env' });


class GlobalState {
  constructor() {
    this.myAccountId = process.env.MY_ACCOUNT_ID;
    this.myPrivateKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);

    if (!this.myAccountId || !this.myPrivateKey) {
      throw new Error("Environment variables MY_ACCOUNT_ID and MY_PRIVATE_KEY must be present");
    }

    this.adminUserAccountId = this.myAccountId;
    this.adminUserAccountPrivateKey = this.myPrivateKey;
    this.adminUserAccountPublicKey = this.adminUserAccountPrivateKey.publicKey;
    this.adminUser = new Wallet(this.adminUserAccountId, this.adminUserAccountPrivateKey);

    this.supplyUserAccountId = this.myAccountId;
    this.supplyUserAccountPrivateKey = this.myPrivateKey
    this.supplyUserAccountPublicKey = this.supplyUserAccountPrivateKey.publicKey;
    this.supplyUser = new Wallet(this.supplyUserAccountId, this.supplyUserAccountPrivateKey); 
    
    this.treasuryAccountId = null;
    this.treasuryAccountPrivateKey = null;

    this.firstAccountId = null;
    this.firstAccountPrivateKey = null;
    this.secondAccountId = null;
    this.secondAccountPrivateKey = null;
    this.thirdAccountId = null;
    this.thirdAccountPrivateKey = null;
    this.fourthAccountId = null;
    this.fourthAccountPrivateKey = null;

    this.testTokenId = null;
    this.tokenTransferTransaction = null;
    this.testTopicId = null;
    this.thresholdKey = null;
    // Create our connection to the Hedera network
    // The Hedera JS SDK makes this really easy!
    this.client = Client.forTestnet();
    this.client.setOperator(this.myAccountId, this.myPrivateKey);

    console.log(`=================== CTOR OK ===================`);
  }

  async createAccount (client, initialBalance) {
    const accountPrivateKey = PrivateKey.generateED25519();
  
    const response = await new AccountCreateTransaction()
      .setInitialBalance(new Hbar(initialBalance))
      .setKey(accountPrivateKey)
      .execute(client);
  
    const receipt = await response.getReceipt(client);

    console.log(`createAccount: ${JSON.stringify(receipt)}`);
  
    return [receipt.accountId, accountPrivateKey];
 }

async initTreasuryAccount(client) {
  if (this.treasuryAccountId && this.treasuryAccountPrivateKey)
    return;
  [this.treasuryAccountId, this.treasuryAccountPrivateKey] = await this.createAccount(client, 500);
}

async createFirstAccount(client, initialBalance) {
  await this.initTreasuryAccount(client);
  [this.firstAccountId, this.firstAccountPrivateKey] = await this.createAccount(client, initialBalance)
}

async createSecondAccount(client, initialBalance) {
  await this.initTreasuryAccount(client);
  [this.secondAccountId, this.secondAccountPrivateKey] = await this.createAccount(client, initialBalance)
}

async createThirdAccount(client, initialBalance) {
  await this.initTreasuryAccount(client);
  [this.thirdAccountId, this.thirdAccountPrivateKey] = await this.createAccount(client, initialBalance)
}

async createFourthAccount(client, initialBalance) {
  await this.initTreasuryAccount(client);
  [this.fourthAccountId, this.fourthAccountPrivateKey] = await this.createAccount(client, initialBalance)
}

async checkMinHbarAmount(accountId, minHbarAmount) {
    // Create the query
    const query = new AccountBalanceQuery()
     .setAccountId(accountId);

    // Sign with the client operator account private key and submit to a Hedera network
    const accountBalance = await query.execute(gs.client);
    const accountBalanceHbar = accountBalance.hbars.toBigNumber();
    if (accountBalance) {
        console.log(`The account balance for account ${accountId} is ${accountBalanceHbar} HBar`);
        //console.log("All account Info:")
        //console.log(JSON.stringify(accountBalance));
    }
  assert(accountBalanceHbar.isGreaterThanOrEqualTo(BigNumber(minHbarAmount)),
    `Account should have at least ${minHbarAmount} but has only ${accountBalanceHbar}`)
}

async queryTokenFunction(functionName, tokenId) {
    const query = new TokenInfoQuery()
        .setTokenId(tokenId);

    console.log("retrieving the " + functionName);
    const body = await query.execute(this.client);

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
  const initialSupply = await this.queryTokenFunction("totalSupply", tokenId);

  // Create the transaction and freeze for manual signing
  const treasuryClient = Client.forTestnet();
  treasuryClient.setOperator(this.treasuryAccountId, this.treasuryAccountPrivateKey);

  const transaction = new TokenMintTransaction()
        .setTokenId(tokenId)
        .setAmount(amount)
        .freezeWith(this.client);

  // Sign the transaction with the client, who is set as admin and treasury account
  const signTx = await transaction.sign(this.treasuryAccountPrivateKey);

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
  // Create the transaction and freeze for manual signing
  const transaction = new TokenCreateTransaction()
      .setTokenName(name)
      .setTokenSymbol(symbol)
      .setTokenType(TokenType.FungibleCommon)
      .setTreasuryAccountId(this.treasuryAccountId)
      .setInitialSupply(supply)
      .setAdminKey(this.supplyUserAccountPublicKey)
      .setSupplyKey(this.supplyUserAccountPublicKey);

  if (fixedSupply) {
    transaction.setMaxSupply(supply);
    transaction.setSupplyType(TokenSupplyType.Finite);
  }

  transaction.freezeWith(this.client);

  // Sign the transaction with the client, who is set as admin and treasury account
  const signTx = await transaction.sign(this.treasuryAccountPrivateKey);

  // Submit to a Hedera network
  const txResponse = await signTx.execute(this.client);

  // Get the receipt of the transaction
  const receipt = await txResponse.getReceipt(this.client);

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
      .setAccountId(this.adminUserAccountId);

  // Sign with the client operator private key and submit to a Hedera network
  const tokenBalance = await balanceQuery.execute(this.client);
  const userBalance = tokenBalance.tokens.get(tokenId);
  console.log(`The balance of the user is: ${userBalance}`);
}

async queryTokenBalance(accountId, tokenId) {
    const balanceQuery = new AccountBalanceQuery()
        .setAccountId(accountId);

    const accountBalances = await balanceQuery.execute(this.client);
    return accountBalances.tokens.get(tokenId);
}

async createTokenTransferTransaction (client, sourceAccountId, sourceAccountPrivateKey, targetAccountId, tokenId, amount) {
  const tokenTransferTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, sourceAccountId, -amount)
    .addTokenTransfer(tokenId, targetAccountId, amount)
    .freezeWith(client)
    .sign(sourceAccountPrivateKey);
  return tokenTransferTx;  
}

async submitTransaction(client, tokenTransferTx) {
  const tokenTransferSubmit = await tokenTransferTx.execute(client);
  const tokenTransferReceipt = await tokenTransferSubmit.getReceipt(client);
  return tokenTransferReceipt;
}

async associateAccountWithToken (client, tokenId, targetAccountId, targetAccountPrivateKey) {
    try {
        const associateTx = await new TokenAssociateTransaction()
          .setAccountId(targetAccountId)
          .setTokenIds([tokenId])
          .freezeWith(client)
          .sign(targetAccountPrivateKey);

        // Submit the transaction.
        const associateTxSubmit = await associateTx.execute(client);

        // Get the receipt of the transaction.
        const associateRx = await associateTxSubmit.getReceipt(client);

        console.log(`Token association with account: ${associateRx.status}`);
    } catch (e) {
        // We may happen to do the association twice, which leads to error, let's ignore it.
        console.log(`Token association with account: ${JSON.stringify(e)}`);
    }
}

async transferTokens(client, tokenId, amount, targetAccountId, treasuryAccountId, treasuryAccountPrivateKey) {
  const tokenTransferTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, treasuryAccountId, -amount)
    .addTokenTransfer(tokenId, targetAccountId, amount)
    .freezeWith(client)
    .sign(treasuryAccountPrivateKey);

  const tokenTransferSubmit = await tokenTransferTx.execute(client);
  const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);
}

async createTopic(memo, submitKey) {
    const transactionId = await new TopicCreateTransaction()
      .setTopicMemo("Taxi rides")
      .setAdminKey(this.myPrivateKey.publicKey)
      .setSubmitKey(this.firstAccountPrivateKey.publicKey)
      .setAutoRenewAccountId(this.myAccountId)
      .execute(this.client);
    const receipt = await transactionId.getReceipt(this.client);
    const topicId = receipt.topicId;
    console.log(`New topic ID is ${topicId.toString()}`);
    this.testTopicId = topicId;
}

async publishMessage(message) {
  const client = Client.forTestnet();
  client.setOperator(this.firstAccountId, this.firstAccountPrivateKey);

  // Submit the message to the topic
  const transactionId = await new TopicMessageSubmitTransaction()
    .setTopicId(this.testTopicId)
    .setMessage(message)
    .freezeWith(this.client);

  // Sign with the submit key
  const signTx = await transactionId.sign(this.firstAccountPrivateKey);

  // Execute the transaction
  const receipt = await signTx.execute(this.client);
  console.log(`The status of message submission: ${JSON.stringify(receipt)}`);
}

async receiveMessage() {
  // Wait 5 seconds between consensus topic creation and subscription
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Create a new topic message query that continuously polls the network for any new messages on the topic
  const subscriptionHandle = new TopicMessageQuery()
    .setTopicId(this.testTopicId)
    .setStartTime(0) // optional, this is unix timestamp (seconds since 1970-01-01T00:00:00Z)
    .subscribe(
      this.client,
      (message) => {
        console.log(`Received message: ${message.contents}`);
        subscriptionHandle.unsubscribe();
      },
      (error) => {
        console.error(`Error receiving message: ${JSON.stringify(error)}`);
        throw new Error(`Error receiving topic message: ${error}`);
      }
    );
}


}

const gs = new GlobalState();


/////////////////////////////////////////////////////////////////////
////////////////////// Step definitions /////////////////////////////

Given('A first hedera account with more than {int} hbar and {int} HTT tokens',
  async function (minHbarAmount, httAmount) {
    await gs.createFirstAccount(gs.client, minHbarAmount + 1)
    await gs.checkMinHbarAmount(gs.firstAccountId, minHbarAmount);
    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.firstAccountId, gs.firstAccountPrivateKey);
    await gs.transferTokens(gs.client, gs.testTokenId, httAmount, gs.firstAccountId,
                            gs.treasuryAccountId, gs.treasuryAccountPrivateKey);
  }
);

Given('a first account with more than {int} hbars', async function (minHbarAmount) {
  await gs.createFirstAccount(gs.client, minHbarAmount + 1)
  await gs.checkMinHbarAmount(gs.firstAccountId, minHbarAmount);
});

Given('A first account with more than {int} hbars', async function (minHbarAmount) {
  await gs.createFirstAccount(gs.client, minHbarAmount + 1)
  await gs.checkMinHbarAmount(gs.firstAccountId, minHbarAmount);
});

Given('A Hedera account with more than {int} hbar', async function (minHbarAmount) {
  await gs.createFirstAccount(gs.client, minHbarAmount + 1)
  await gs.checkMinHbarAmount(gs.firstAccountId, minHbarAmount);
});

Given('A first hedera account with more than {int} hbar', async function (minHbarAmount) {
  await gs.createFirstAccount(gs.client, minHbarAmount + 1)
  await gs.checkMinHbarAmount(gs.firstAccountId, minHbarAmount);
});

Given('The first account holds {int} HTT tokens', async function (amount) {
  await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.firstAccountId, gs.firstAccountPrivateKey);
  const targetAccountBalance = await gs.queryTokenBalance(gs.firstAccountId, gs.testTokenId);
  console.log("targetAccountBalance: ${targetAccountBalance}")
  console.log("amount: ${amount}")
  if (targetAccountBalance < amount) {
    await gs.transferTokens(gs.client, gs.testTokenId, amount - targetAccountBalance,
                            gs.firstAccountId, gs.treasuryAccountId, gs.treasuryAccountPrivateKey);
  } else {
    await gs.transferTokens(gs.client, gs.testTokenId, targetAccountBalance - amount,
                         gs.treasuryAccountId, gs.firstAccountId, gs.firstAccountPrivateKey);
  }
});

When('A topic is created with the memo {string} with the first account as the submit key',
  async function (memo) {
    await gs.createTopic(memo, gs.firstAccountPrivateKey.publicKey);
});

When('The message {string} is published to the topic', async function (message) {
  await gs.publishMessage(message);
});

Then('The message is received by the topic and can be printed to the console', async function () {
  await gs.receiveMessage();
});

Given('A second account with more than {int} hbars', async function (minHbarAmount) {
  await gs.createSecondAccount(gs.client, minHbarAmount + 1);
  await gs.checkMinHbarAmount(gs.secondAccountId, minHbarAmount);
});

Given('A {int} of {int} threshold key with the first and second account',
  async function (requiredSignatures, numberOfKeys) {
    assert(numberOfKeys === 2, "The way the step is defined currently requires number of keys to be 2 (first and second account)");
    assert(requiredSignatures == 1 || requiredSignatures == 2, "Currently requiredSignatures can only be 1 or 2");

    gs.thresholdKey = new KeyList([gs.firstAccountPrivateKey.publicKey, gs.secondAccountPrivateKey.publicKey], requiredSignatures);
});

 When('A topic is created with the memo {string} with the threshold key as the submit key', async function (memo) {
    await gs.createTopic(memo, gs.thresholdKey);
 });

When('I create a token named Test Token \\(HTT)', async function () {
  await gs.createTestToken("Test Token", 'HTT', 1000, false);
});

Given('A token named Test Token \\(HTT) with {int} tokens',
  async function (tokenSupply) {
    await gs.initTreasuryAccount(gs.client);
    return await gs.createTestToken("Test Token", 'HTT', tokenSupply, false);
});

When('I create a fixed supply token named Test Token \\(HTT) with {int} tokens',
  async function (tokenSupply) {
    return await gs.createTestToken("Test Token", 'HTT', tokenSupply, true);
});

Then('The token has the name {string}', async function (name) {
  return await gs.checkTokenHasName(gs.testTokenId, name);
});

Then('The token has the symbol {string}', async function (symbol) {
  return await gs.checkTokenHasSymbol(gs.testTokenId, symbol);
});

Then('The token has {int} decimals', async function (decimals) {
  return await gs.checkTokenHasDecimals(gs.testTokenId, decimals);
});

Then('The token is owned by the account', async function () {
  await gs.checkTokenAdminKey(gs.testTokenId, gs.adminUserAccountPublicKey);
});

Then('An attempt to mint {int} additional tokens succeeds', async function (tokenAmount) {
  await gs.mintTokens(gs.testTokenId, tokenAmount);
});

Then('The total supply of the token is {int}', async function (totalSupply) {
  await gs.checkTokenTotalSupply(gs.testTokenId, totalSupply);
});

Then('An attempt to mint tokens fails', async function () {
  const initialSupply = await gs.queryTokenFunction("totalSupply", gs.testTokenId);
  try {
    await gs.mintTokens(gs.testTokenId, 10000);
    throw new Error("Should throw TOKEN_MAX_SUPPLY_REACHED");
  } catch (error) {
    console.log(`error minting token: ${JSON.stringify(error)}`);
    // OK, expected.
  }
  await gs.checkTokenTotalSupply(gs.testTokenId, initialSupply.toInt());
});

Given('A second Hedera account', async function () {
  // Initial HBAR balance not specified, let's assume it's 0.
  await gs.createSecondAccount(gs.client, 0);
});

Given('The second account holds {int} HTT tokens', async function (amount) {
  await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.secondAccountId, gs.secondAccountPrivateKey);
  await gs.transferTokens(gs.client, gs.testTokenId, amount, gs.secondAccountId,
                          gs.treasuryAccountId, gs.treasuryAccountPrivateKey);
});

Then('The third account holds {int} HTT tokens', async function (amount) {
  const actualAmount = await gs.queryTokenBalance(gs.thirdAccountId, gs.testTokenId);
  assert(actualAmount == amount, `Third account holds ${actualAmount} HTT, expected ${amount}`)
});

Then('The fourth account holds {int} HTT tokens', async function (amount) {
  const actualAmount = await gs.queryTokenBalance(gs.fourthAccountId, gs.testTokenId);
  assert(actualAmount == amount, `Fourth account holds ${actualAmount} HTT, expected ${amount}`)
});

When('The first account creates a transaction to transfer {int} HTT tokens to the second account',
  async function (amount) {
    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.secondAccountId, gs.secondAccountPrivateKey);
    gs.tokenTransferTransaction = await gs.createTokenTransferTransaction(
      gs.client, gs.firstAccountId, gs.firstAccountPrivateKey,
      gs.secondAccountId, gs.testTokenId, amount
    )
});

When('The first account submits the transaction', async function () {
  const client = Client.forTestnet();
  client.setOperator(gs.firstAccountId, gs.firstAccountPrivateKey);

  await gs.tokenTransferTransaction.sign(gs.firstAccountPrivateKey)
  const tokenTransferReceipt = await gs.submitTransaction(client, gs.tokenTransferTransaction); 
});

When('The second account creates a transaction to transfer {int} HTT tokens to the first account', async function (amount) {
    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.firstAccountId, gs.firstAccountPrivateKey);
    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.secondAccountId, gs.secondAccountPrivateKey);
    gs.tokenTransferTransaction = await gs.createTokenTransferTransaction(
      gs.client, gs.secondAccountId, gs.secondAccountPrivateKey,
      gs.firstAccountId, gs.testTokenId, amount
    )
});

Then('The first account has paid for the transaction fee', async function () {
  // TODO
});

Given('A second Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await gs.createSecondAccount(gs.client, hbarAmount);
    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.secondAccountId, gs.secondAccountPrivateKey);
    await gs.transferTokens(gs.client, gs.testTokenId, httAmount, gs.secondAccountId,
                            gs.treasuryAccountId, gs.treasuryAccountPrivateKey);
});

Given('A third Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await gs.createThirdAccount(gs.client, hbarAmount);
    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.thirdAccountId, gs.thirdAccountPrivateKey);
    await gs.transferTokens(gs.client, gs.testTokenId, httAmount, gs.thirdAccountId,
                         gs.treasuryAccountId, gs.treasuryAccountPrivateKey);
});

Given('A fourth Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await gs.createFourthAccount(gs.client, hbarAmount);
    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.fourthAccountId, gs.fourthAccountPrivateKey);
    await gs.transferTokens(gs.client, gs.testTokenId, httAmount, gs.fourthAccountId,
                         gs.treasuryAccountId, gs.treasuryAccountPrivateKey);
});

When('A transaction is created to transfer {int} HTT tokens out of the first and second account'
     +' and {int} HTT tokens into the third account'
     +' and {int} HTT tokens into the fourth account',
  async function (firstAndSecondOutflowAmount, thirdInflowAmount, fourthInflowAmount) {

    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.thirdAccountId, gs.thirdAccountPrivateKey);
    await gs.associateAccountWithToken (gs.client, gs.testTokenId, gs.fourthAccountId, gs.fourthAccountPrivateKey);

    const nodeId = AccountId.fromString("0.0.3");

    const tx = new TransferTransaction()
      .addTokenTransfer(gs.testTokenId, gs.firstAccountId, -firstAndSecondOutflowAmount)
      .addTokenTransfer(gs.testTokenId, gs.secondAccountId, -firstAndSecondOutflowAmount)
      .addTokenTransfer(gs.testTokenId, gs.thirdAccountId, thirdInflowAmount)
      .addTokenTransfer(gs.testTokenId, gs.fourthAccountId, fourthInflowAmount)
      .setNodeAccountIds([nodeId])
      .freezeWith(gs.client)
      ;

    const signature1 = gs.firstAccountPrivateKey.signTransaction(tx);  
    const signature2 = gs.secondAccountPrivateKey.signTransaction(tx);  
    const signature3 = gs.thirdAccountPrivateKey.signTransaction(tx); 
    const signature4 = gs.fourthAccountPrivateKey.signTransaction(tx); 

    tx.addSignature(gs.firstAccountPrivateKey.publicKey, signature1);
    tx.addSignature(gs.secondAccountPrivateKey.publicKey, signature2);
    tx.addSignature(gs.thirdAccountPrivateKey.publicKey, signature3);
    tx.addSignature(gs.fourthAccountPrivateKey.publicKey, signature4);
    
    gs.tokenTransferTransaction = tx;
});
