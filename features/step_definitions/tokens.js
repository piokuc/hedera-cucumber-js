const assert = require('assert');
const { BigNumber } = require('bignumber.js');

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

module.exports = { TokenService };
