# Demo of Hedera JavaScript SDK tests utilizing cucumber.js

This package contains example Cucumber features definitions that exercise
various Hedera Token and Consensus Service scenarios.

The tests can be executed on Hedera Testnet.

## Run it

To run it, you need to first put a file `.env` in this directory,
with following variables defined:

```
MY_ACCOUNT_ID = 0.0.14000000
MY_PRIVATE_KEY = 30300aaaaaaaaaaaaa2aa1aaaaaaaaaa0aaaa8a6aaaaaf1a8aaaaa1aa4aa3aaaaaaaeaaaaaaaa8aaaaaaaaa3caaaaaaa0aaa

```

Create your account, private key and test HBAR necessary to execute the transactions using Hedera Testnet faucet.

Next run the following `npm` commands in your terminal.
Make sure you have `node` version `18.9`.
It is recommended to use `nvm` to manage `node` versions.

```
npm install
npm test
```

You should see Cucumber running the tests and producing some logs ending with a summary looking like this:

```
7 scenarios (7 passed)
55 steps (55 passed)
1m41.615s (executing steps: 1m41.527s)
```
