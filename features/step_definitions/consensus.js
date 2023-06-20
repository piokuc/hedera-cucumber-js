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

module.exports = { ConsensusService };
