var Wallet = artifacts.require('MultiSigWallet');
var ConvertLib = artifacts.require('./ConvertLib.sol');
var BundleToken = artifacts.require('./BundleToken.sol');

var preSaleStartTime = Math.floor(new Date().getTime() / 1000) + 5 * 60 * 60 * 24; // starts in 5 days
var preSaleEndTime = preSaleStartTime + 10 * 24 * 60 * 60; // lasts 10 days
var crowdsaleStartTime = preSaleEndTime + 10 * 24 * 60 * 60; // lasts 10 days
var crowdsaleEndTime = crowdsaleStartTime + 10 * 24 * 60 * 60; // lasts 10 days

module.exports = async function(deployer) {
  await deployer.deploy(ConvertLib);
  await deployer.link(ConvertLib, BundleToken);
  await deployer.deploy(Wallet, [web3.eth.accounts[0], web3.eth.accounts[1], web3.eth.accounts[2]], 2);
  await deployer.deploy(
    BundleToken,
    Wallet.address,
    web3.toWei(1000, 'ether'),
    web3.toWei(30000, 'ether'),
    preSaleStartTime,
    preSaleEndTime,
    crowdsaleStartTime,
    crowdsaleEndTime
  );
};
