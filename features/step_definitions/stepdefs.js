const assert = require('assert');
const { BigNumber } = require('bignumber.js');
const { Given, When, Then, setDefaultTimeout } = require('@cucumber/cucumber');

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
    AccountId
} = require("@hashgraph/sdk");
require('dotenv').config({ path: '.env' });

const myAccountId = process.env.MY_ACCOUNT_ID;
const myPrivateKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);

if (myAccountId == null || myPrivateKey == null ) {
    throw new Error("Environment variables MY_ACCOUNT_ID and MY_PRIVATE_KEY must be present");
}

//const otherAccountId = process.env.OTHER_ACCOUNT_ID;
//const otherPrivateKey = PrivateKey.fromString(process.env.OTHER_PRIVATE_KEY);

//if (otherAccountId == null || otherPrivateKey == null) {
//    throw new Error("Environment variables OTHER_ACCOUNT_ID and OTHER_PRIVATE_KEY must be present");
//}

const adminUserAccountId = myAccountId;
const adminUserAccountPrivateKey = myPrivateKey;
const adminUserAccountPublicKey = adminUserAccountPrivateKey.publicKey;
const adminUser = new Wallet(adminUserAccountId, adminUserAccountPrivateKey);

const supplyUserAccountId = myAccountId;
const supplyUserAccountPrivateKey = myPrivateKey
const supplyUserAccountPublicKey = supplyUserAccountPrivateKey.publicKey;
const supplyUser = new Wallet(supplyUserAccountId, supplyUserAccountPrivateKey);

async function createAccount (client, initialBalance) {
  const accountPrivateKey = PrivateKey.generateED25519();
  
  const response = await new AccountCreateTransaction()
    .setInitialBalance(new Hbar(initialBalance))
    .setKey(accountPrivateKey)
    .execute(client);
  
  const receipt = await response.getReceipt(client);

  console.log(`createAccount: ${JSON.stringify(receipt)}`);
  
  return [receipt.accountId, accountPrivateKey];
 }

// Create our connection to the Hedera network
// The Hedera JS SDK makes this really easy!
const client = Client.forTestnet();
client.setOperator(myAccountId, myPrivateKey);

let treasuryAccountId, treasuryAccountPrivateKey;

let firstAccountId, firstAccountPrivateKey;
let secondAccountId, secondAccountPrivateKey;
let thirdAccountId, thirdAccountPrivateKey;
let fourthAccountId, fourthAccountPrivateKey;

let testTokenId;
let tokenTransferTransaction;

async function initTreasuryAccount(client) {
  if (treasuryAccountId && treasuryAccountPrivateKey)
    return;
  [treasuryAccountId, treasuryAccountPrivateKey] = await createAccount(client, 500);
}

async function createFirstAccount(client, initialBalance) {
  await initTreasuryAccount(client);
  [firstAccountId, firstAccountPrivateKey] = await createAccount(client, initialBalance)
}

async function createSecondAccount(client, initialBalance) {
  await initTreasuryAccount(client);
  [secondAccountId, secondAccountPrivateKey] = await createAccount(client, initialBalance)
}

async function createThirdAccount(client, initialBalance) {
  await initTreasuryAccount(client);
  [thirdAccountId, thirdAccountPrivateKey] = await createAccount(client, initialBalance)
}

async function createFourthAccount(client, initialBalance) {
  await initTreasuryAccount(client);
  [fourthAccountId, fourthAccountPrivateKey] = await createAccount(client, initialBalance)
}

async function checkMinHbarAmount(accountId, minHbarAmount) {
    // Create the query
    const query = new AccountBalanceQuery()
     .setAccountId(accountId);

    // Sign with the client operator account private key and submit to a Hedera network
    const accountBalance = await query.execute(client);
    const accountBalanceHbar = accountBalance.hbars.toBigNumber();
    if (accountBalance) {
        console.log(`The account balance for account ${accountId} is ${accountBalanceHbar} HBar`);
        //console.log("All account Info:")
        //console.log(JSON.stringify(accountBalance));
    }
  assert(accountBalanceHbar.isGreaterThanOrEqualTo(BigNumber(minHbarAmount)),
    `Account should have at least ${minHbarAmount} but has only ${accountBalanceHbar}`)
}

async function queryTokenFunction(functionName, tokenId) {
    const query = new TokenInfoQuery()
        .setTokenId(tokenId);

    console.log("retrieving the " + functionName);
    const body = await query.execute(client);

    const result = functionName === "name" ? body.name
                 : functionName === "symbol" ? body.symbol
                 : functionName === "totalSupply" ? body.totalSupply
                 : functionName === "decimals" ? body.decimals
                 : functionName === "adminKey" ? body.adminKey
                 : null;
    return result
}

async function checkTokenHasName(tokenId, name) {
  const tokenName = await queryTokenFunction("name", tokenId);
  assert(name === tokenName, `Test token has name "${tokenName}", expected "${name}"`)
  return true;
}

async function checkTokenHasSymbol(tokenId, symbol) {
  const tokenSymbol = await queryTokenFunction("symbol", tokenId);
  assert(symbol === tokenSymbol, `Test token has symbol "${tokenSymbol}", expected "${symbol}"`)
  return true;
}

async function checkTokenHasDecimals(tokenId, decimals) {
  const tokenDecimals = await queryTokenFunction("decimals", tokenId);
  assert(decimals === tokenDecimals, `Test token has decimals "${tokenDecimals}", expected "${decimals}"`)
  return true;
}

async function checkTokenAdminKey(tokenId, adminKey) {
  const tokenAdminKey = await queryTokenFunction("adminKey", tokenId);

  console.log(`====> ${JSON.stringify({tokenAdminKey})}`);

  assert(adminKey.toString() === tokenAdminKey.toString(),
   `Test token has adminKey "${tokenAdminKey}", expected "${adminKey}"`)
  return true;
}

async function checkTokenTotalSupply(tokenId, totalSupply) {
  const tokenTotalSupply = await queryTokenFunction("totalSupply", tokenId);
  console.log(`typeof tokenTotalSupply:  ${typeof tokenTotalSupply}`);
  console.log('---------------');
  console.log(JSON.stringify(tokenTotalSupply));
  console.log(JSON.stringify(totalSupply));
  console.log('---------------');
  assert(tokenTotalSupply.toInt() === totalSupply,
    `Total supply is ${tokenTotalSupply}, expected ${totalSupply}`
  );
}

async function mintTokens(tokenId, amount) {
  const initialSupply = await queryTokenFunction("totalSupply", tokenId);
  // Create the transaction and freeze for manual signing

  const treasuryClient = Client.forTestnet();
  treasuryClient.setOperator(treasuryAccountId, treasuryAccountPrivateKey);

  const transaction = new TokenMintTransaction()
        .setTokenId(tokenId)
        .setAmount(amount)
        .freezeWith(client);

  // Sign the transaction with the client, who is set as admin and treasury account
  const signTx = await transaction.sign(treasuryAccountPrivateKey);

  // Submit the signed transaction to a Hedera network
  const txResponse = await signTx.execute(treasuryClient);

  // Request the receipt of the transaction
  const receipt = await txResponse.getReceipt(treasuryClient);

  // Get the transaction consensus status
  const transactionStatus = receipt.status.toString();

  console.log("The mint transaction consensus status is ", transactionStatus);

  const finalSupply = await queryTokenFunction("totalSupply", tokenId);

  console.log(`initialSupply  : ${initialSupply}`)
  console.log(`finalSupply  : ${finalSupply}`)
  assert(finalSupply.equals(initialSupply.add(amount)),
    `Initial supply was ${initialSupply}, after minting ${amount} tokens`
    + ` final supply should be ${initialSupply.add(amount)}, was ${finalSupply}`);
}

async function createTestToken(name, symbol, supply, fixedSupply) {
  // Create the transaction and freeze for manual signing
  console.log(`adminUser ----> ${JSON.stringify(adminUser)}`)
  console.log(`supplyUser ----> ${JSON.stringify(supplyUser)}`)
  const transaction = new TokenCreateTransaction()
      .setTokenName(name)
      .setTokenSymbol(symbol)
      .setTokenType(TokenType.FungibleCommon)
      .setTreasuryAccountId(treasuryAccountId)
      .setInitialSupply(supply)
      .setAdminKey(supplyUserAccountPublicKey)
      .setSupplyKey(supplyUserAccountPublicKey);

  if (fixedSupply) {
    transaction.setMaxSupply(supply);
    transaction.setSupplyType(TokenSupplyType.Finite);
  }

  transaction.freezeWith(client);

  // Sign the transaction with the client, who is set as admin and treasury account
  const signTx = await transaction.sign(treasuryAccountPrivateKey);

  // Submit to a Hedera network
  const txResponse = await signTx.execute(client);

  // Get the receipt of the transaction
  const receipt = await txResponse.getReceipt(client);

  // Get the token ID from the receipt
  const tokenId = receipt.tokenId;

  testTokenId = tokenId;

  console.log("The new token ID is " + tokenId);

  const tokenName = await queryTokenFunction("name", tokenId);
  const tokenSymbol = await queryTokenFunction("symbol", tokenId);
  const tokenSupply = await queryTokenFunction("totalSupply", tokenId);
  console.log('The total supply of the ' + tokenName + ' token is ' + tokenSupply + ' of ' + tokenSymbol);

  // Create the query
  const balanceQuery = new AccountBalanceQuery()
      .setAccountId(adminUserAccountId);

  // Sign with the client operator private key and submit to a Hedera network
  const tokenBalance = await balanceQuery.execute(client);

  console.log("The balance of the user is: " + tokenBalance.tokens.get(tokenId));

}

async function queryTokenBalance(accountId, tokenId) {
    const balanceQuery = new AccountBalanceQuery()
        .setAccountId(accountId);

    const accountBalances = await balanceQuery.execute(client);

    return accountBalances.tokens.get(tokenId);
}

Given('A first hedera account with more than {int} hbar and {int} HTT tokens',
  async function (minHbarAmount, httAmount) {
    await createFirstAccount(client, minHbarAmount + 1)
    await checkMinHbarAmount(firstAccountId, minHbarAmount);
    await associateAccountWithToken (client, testTokenId, firstAccountId, firstAccountPrivateKey);
    await transferTokens(client, testTokenId, httAmount, firstAccountId,
                         treasuryAccountId, treasuryAccountPrivateKey);
  }
);

Given('a first account with more than {int} hbars', async function (minHbarAmount) {
  await createFirstAccount(client, minHbarAmount + 1)
  await checkMinHbarAmount(firstAccountId, minHbarAmount);
});

Given('A first account with more than {int} hbars', async function (minHbarAmount) {
  await createFirstAccount(client, minHbarAmount + 1)
  await checkMinHbarAmount(firstAccountId, minHbarAmount);
});

Given('A Hedera account with more than {int} hbar', async function (minHbarAmount) {
  await createFirstAccount(client, minHbarAmount + 1)
  await checkMinHbarAmount(firstAccountId, minHbarAmount);
});

Given('A first hedera account with more than {int} hbar', async function (minHbarAmount) {
  await createFirstAccount(client, minHbarAmount + 1)
  await checkMinHbarAmount(firstAccountId, minHbarAmount);
});

async function createTokenTransferTransaction (
  client, sourceAccountId, sourceAccountPrivateKey,
  targetAccountId, tokenId, amount
) {
  const tokenTransferTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, sourceAccountId, -amount)
    .addTokenTransfer(tokenId, targetAccountId, amount)
    .freezeWith(client)
    .sign(sourceAccountPrivateKey);
  return tokenTransferTx;  
}

async function submitTransaction(client, tokenTransferTx) {
  const tokenTransferSubmit = await tokenTransferTx.execute(client);
  const tokenTransferReceipt = await tokenTransferSubmit.getReceipt(client);
  return tokenTransferReceipt;
}

async function associateAccountWithToken (client, tokenId, targetAccountId, targetAccountPrivateKey) {
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

async function transferTokens(client, tokenId, amount, targetAccountId,
                              treasuryAccountId, treasuryAccountPrivateKey) {
  const tokenTransferTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, treasuryAccountId, -amount)
    .addTokenTransfer(tokenId, targetAccountId, amount)
    .freezeWith(client)
    .sign(treasuryAccountPrivateKey);

  const tokenTransferSubmit = await tokenTransferTx.execute(client);
  const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);
}


Given('The first account holds {int} HTT tokens', async function (amount) {
  await associateAccountWithToken (client, testTokenId, firstAccountId, firstAccountPrivateKey);
  const targetAccountBalance = await queryTokenBalance(firstAccountId, testTokenId);
  console.log("targetAccountBalance: ${targetAccountBalance}")
  console.log("amount: ${amount}")
  if (targetAccountBalance < amount) {
    await transferTokens(client, testTokenId, amount - targetAccountBalance,
                        firstAccountId, treasuryAccountId, treasuryAccountPrivateKey);
  } else {
    await transferTokens(client, testTokenId, targetAccountBalance - amount,
                        treasuryAccountId, firstAccountId, firstAccountPrivateKey);
  }
});

When('A topic is created with the memo {string} with the first account as the submit key',
  async function (memo) {
  //  await createTopic(memo);
  return 'Pending';
});

 When('The message {string} is published to the topic', function (string) {
   // Write code here that turns the phrase above into concrete actions
   return 'pending';
 });

 Then('The message is received by the topic and can be printed to the console', function () {
   // Write code here that turns the phrase above into concrete actions
   return 'pending';
 });


Given('A second account with more than {int} hbars', async function (minHbarAmount) {
  await createSecondAccount(client, minHbarAmount + 1);
  await checkMinHbarAmount(secondAccountId, minHbarAmount);
});

 Given('A {int} of {int} threshold key with the first and second account', function (int, int2) {
 // Given('A {int} of {float} threshold key with the first and second account', function (int, float) {
 // Given('A {float} of {int} threshold key with the first and second account', function (float, int) {
 // Given('A {float} of {float} threshold key with the first and second account', function (float, float2) {
   // Write code here that turns the phrase above into concrete actions
   return 'pending';
 });

 When('A topic is created with the memo {string} with the threshold key as the submit key', function (string) {
   // Write code here that turns the phrase above into concrete actions
   return 'pending';
 });

When('I create a token named Test Token \\(HTT)', async function () {
  await createTestToken("Test Token", 'HTT', 1000, false);
});

Given('A token named Test Token \\(HTT) with {int} tokens',
  async function (tokenSupply) {
    await initTreasuryAccount(client);
    return await createTestToken("Test Token", 'HTT', tokenSupply, false);
});

When('I create a fixed supply token named Test Token \\(HTT) with {int} tokens',
  async function (tokenSupply) {
    return await createTestToken("Test Token", 'HTT', tokenSupply, true);
});

Then('The token has the name {string}', async function (name) {
  return await checkTokenHasName(testTokenId, name);
});

Then('The token has the symbol {string}', async function (symbol) {
  return await checkTokenHasSymbol(testTokenId, symbol);
});

Then('The token has {int} decimals', async function (decimals) {
  return await checkTokenHasDecimals(testTokenId, decimals);
});

Then('The token is owned by the account', async function () {
  await checkTokenAdminKey(testTokenId, adminUserAccountPublicKey);
});

Then('An attempt to mint {int} additional tokens succeeds', async function (tokenAmount) {
  await mintTokens(testTokenId, tokenAmount);
});

Then('The total supply of the token is {int}', async function (totalSupply) {
  await checkTokenTotalSupply(testTokenId, totalSupply);
});

Then('An attempt to mint tokens fails', async function () {
  const initialSupply = await queryTokenFunction("totalSupply", testTokenId);
  try {
    await mintTokens(testTokenId, 10000);
    throw new Error("Should throw TOKEN_MAX_SUPPLY_REACHED");
  } catch (error) {
    console.log(`error: ${JSON.stringify(error)}`);
    // OK, expected.
  }
  await checkTokenTotalSupply(testTokenId, initialSupply.toInt());
});

Given('A second Hedera account', async function () {
  // Initial HBAR balance not specified, let's assume it's 0.
  await createSecondAccount(client, 0);
});

Given('The second account holds {int} HTT tokens', async function (amount) {
  await associateAccountWithToken (client, testTokenId, secondAccountId, secondAccountPrivateKey);
  await transferTokens(client, testTokenId, amount, secondAccountId,
                       treasuryAccountId, treasuryAccountPrivateKey);
});

Then('The third account holds {int} HTT tokens', async function (amount) {
  const actualAmount = await queryTokenBalance(thirdAccountId, testTokenId);
  assert(actualAmount == amount, `Third account holds ${actualAmount} HTT, expected ${amount}`)
});

Then('The fourth account holds {int} HTT tokens', async function (amount) {
  const actualAmount = await queryTokenBalance(fourthAccountId, testTokenId);
  assert(actualAmount == amount, `Fourth account holds ${actualAmount} HTT, expected ${amount}`)
});


When('The first account creates a transaction to transfer {int} HTT tokens to the second account',
  async function (amount) {
    await associateAccountWithToken (client, testTokenId, secondAccountId, secondAccountPrivateKey);
    tokenTransferTransaction = await createTokenTransferTransaction(
      client, firstAccountId, firstAccountPrivateKey,
      secondAccountId, testTokenId, amount
    )
});

When('The first account submits the transaction', async function () {
  const client = Client.forTestnet();
  client.setOperator(firstAccountId, firstAccountPrivateKey);

  await tokenTransferTransaction.sign(firstAccountPrivateKey)
  const tokenTransferReceipt = await submitTransaction(client, tokenTransferTransaction); 
});

When('The second account creates a transaction to transfer {int} HTT tokens to the first account', async function (amount) {
    await associateAccountWithToken (client, testTokenId, firstAccountId, firstAccountPrivateKey);
    await associateAccountWithToken (client, testTokenId, secondAccountId, secondAccountPrivateKey);
    tokenTransferTransaction = await createTokenTransferTransaction(
      client, secondAccountId, secondAccountPrivateKey,
      firstAccountId, testTokenId, amount
    )
});

Then('The first account has paid for the transaction fee', async function () {
  // TODO
});

Given('A second Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await createSecondAccount(client, hbarAmount);
    await associateAccountWithToken (client, testTokenId, secondAccountId, secondAccountPrivateKey);
    await transferTokens(client, testTokenId, httAmount, secondAccountId,
                         treasuryAccountId, treasuryAccountPrivateKey);
});

Given('A third Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await createThirdAccount(client, hbarAmount);
    await associateAccountWithToken (client, testTokenId, thirdAccountId, thirdAccountPrivateKey);
    await transferTokens(client, testTokenId, httAmount, thirdAccountId,
                         treasuryAccountId, treasuryAccountPrivateKey);
});

Given('A fourth Hedera account with {int} hbar and {int} HTT tokens',
  async function (hbarAmount, httAmount) {
    await createFourthAccount(client, hbarAmount);
    await associateAccountWithToken (client, testTokenId, fourthAccountId, fourthAccountPrivateKey);
    await transferTokens(client, testTokenId, httAmount, fourthAccountId,
                         treasuryAccountId, treasuryAccountPrivateKey);
});

When('A transaction is created to transfer {int} HTT tokens out of the first and second account'
     +' and {int} HTT tokens into the third account'
     +' and {int} HTT tokens into the fourth account',
  async function (firstAndSecondOutflowAmount, thirdInflowAmount, fourthInflowAmount) {

    await associateAccountWithToken (client, testTokenId, thirdAccountId, thirdAccountPrivateKey);
    await associateAccountWithToken (client, testTokenId, fourthAccountId, fourthAccountPrivateKey);


    const nodeId = AccountId.fromString("0.0.3");

    const tx = new TransferTransaction()
      .addTokenTransfer(testTokenId, firstAccountId, -firstAndSecondOutflowAmount)
      .addTokenTransfer(testTokenId, secondAccountId, -firstAndSecondOutflowAmount)
      .addTokenTransfer(testTokenId, thirdAccountId, thirdInflowAmount)
      .addTokenTransfer(testTokenId, fourthAccountId, fourthInflowAmount)
      .setNodeAccountIds([nodeId])
      .freezeWith(client)
      ;

    const signature1 = firstAccountPrivateKey.signTransaction(tx);  
    const signature2 = secondAccountPrivateKey.signTransaction(tx);  
    const signature3 = thirdAccountPrivateKey.signTransaction(tx); 
    const signature4 = fourthAccountPrivateKey.signTransaction(tx); 

    tx.addSignature(firstAccountPrivateKey.publicKey, signature1);
    tx.addSignature(secondAccountPrivateKey.publicKey, signature2);
    tx.addSignature(thirdAccountPrivateKey.publicKey, signature3);
    tx.addSignature(fourthAccountPrivateKey.publicKey, signature4);
    
    tokenTransferTransaction = tx;
});
