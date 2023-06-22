const assert = require('assert');
const { BigNumber } = require('bignumber.js');

const {
    AccountCreateTransaction,
    Client,
    AccountBalanceQuery,
    PrivateKey,
    Hbar,
    TransferTransaction,
    Status
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
      const transferDescription = `transfer HBAR: ${sourceAccount.id} => ${targetAccount.id} for ${hbarAmount} HBAR`;
      if (receipt.status !== Status.Success) {
        throw new Error(`${transferDescription}: ${receipt.status}`); 
      }
      console.log(`${transferDescription}: ${receipt.status}`);
  }

  async initAccount(name, hbarBalance) {
    console.log(`initAccount: "${name}", initial HBAR balance: ${hbarBalance}`);
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
    console.log(`_createAccount: ${receipt.status}`);
    if (receipt.status !== Status.Success) {
      throw new Error(`Minting account failed: ${receipt.status}`);
    }
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

module.exports = { Account, AccountsManager };