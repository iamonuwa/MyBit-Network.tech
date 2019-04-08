var bn = require('bignumber.js');
bn.config({ EXPONENTIAL_AT: 80 });

const AssetToken = artifacts.require("./tokens/erc20/DividendTokenERC20.sol");
const MyBitToken = artifacts.require("./tokens/erc20/MyBitToken.sol");
const Minter = artifacts.require("./database/Minter.sol");
const Crowdsale = artifacts.require("./crowdsale/CrowdsaleERC20.sol");
const CrowdsaleGenerator = artifacts.require("./crowdsale/CrowdsaleGeneratorERC20.sol");
const CrowdsaleReserve = artifacts.require("./database/CrowdsaleReserve.sol");
const EscrowReserve = artifacts.require("./database/EscrowReserve.sol");
const AssetManagerEscrow = artifacts.require("./roles/AssetManagerEscrow.sol");
const Database = artifacts.require("./database/Database.sol");
const Events = artifacts.require("./database/Events.sol");
const ContractManager = artifacts.require("./database/ContractManager.sol");
const HashFunctions = artifacts.require("./test/HashFunctions.sol");
const Pausible = artifacts.require("./ownership/Pausible.sol");
const AssetManagerFunds = artifacts.require("./roles/AssetManagerFunds.sol");
const Operators = artifacts.require("./roles/Operators.sol");
const Platform = artifacts.require("./ecosystem/Platform.sol");
const API = artifacts.require("./database/API.sol");

const ETH = bn(10**18);
const scaling = bn(10**36);
const tokenSupply = bn(180000000).times(ETH);
const tokenPerAccount = bn(1000).times(ETH);

//Just passing an empty address for kyber, since no converting is being done
const kyber = {
  address : '0x0000000000000000000000000000000000000000'
};

contract('ERC20 Crowdsale', async(accounts) => {
  const owner = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  const user3 = accounts[3];
  const assetManager = accounts[4];
  const operator = accounts[5];
  const tokenHolders = [user1, user2, user3, assetManager, operator];

  let assetToken;
  let erc20;
  let platformToken;
  let minter;
  let crowdsale;
  let crowdsaleGen;   // crowdsale generator
  let crowdsaleReserve;
  let escrowReserve;
  let escrow;
  let db;
  let events;
  let cm;
  let hash;
  let api;
  let platform;
  let assetManagerFunds;
  let assetManagerFee;
  let operators;
  let operatorID;
  let assetURI;
  let assetAddress;
  let pausible;

  it('Deploy database contract', async() => {
    db = await Database.new([owner], true);
  });

  it('Deploy Events', async() => {
    events = await Events.new(db.address);
  });

  it('Deploy contract manager contract', async() => {
    cm = await ContractManager.new(db.address, events.address);
    await db.enableContractManagement(cm.address);
  });

  it('Deploy hashing contract', async() => {
    hash = await HashFunctions.new(db.address);
  });

  it('Deploy api contract', async() => {
    api = await API.new(db.address);
  });

  it('Deploy MyB token', async() => {
    platformToken = await MyBitToken.new('MyBit', 'MYB', tokenSupply.toString());
  });

  it("Spread tokens to users", async() => {
    let userBalance;
    for (var i = 1; i < accounts.length; i++) {
      //console.log(accounts[i]);
      await platformToken.transfer(accounts[i], tokenPerAccount.toString());
      userBalance = bn(await platformToken.balanceOf(accounts[i]));
      assert.equal(userBalance.eq(tokenPerAccount), true);
    }
    // Check token ledger is correct
    let totalTokensCirculating = (accounts.length-1) * tokenPerAccount;
    let remainingTokens = bn(tokenSupply).minus(totalTokensCirculating);
    let ledgerTrue = bn(await platformToken.balanceOf(owner)).eq(remainingTokens);
    assert.equal(ledgerTrue, true);
  });

  it('Deploy platform funds', async() => {
    platform = await Platform.new(db.address, events.address);
    await cm.addContract('Platform', platform.address);
    await platform.setPlatformToken(platformToken.address);
    await platform.setPlatformFee('3');
  });

  it('Deploy assetManager escrow', async() => {
    escrow = await AssetManagerEscrow.new(db.address, events.address);
    await cm.addContract('AssetManagerEscrow', escrow.address);
  });

  it('Deploy asset manager funds', async() => {
    assetManagerFunds = await AssetManagerFunds.new(db.address, events.address);
    await cm.addContract('AssetManagerFunds', assetManagerFunds.address);
  });

  it('Deploy pausible contract', async() => {
    pausible = await Pausible.new(db.address, events.address);
    await cm.addContract('Pausible', pausible.address);
  });

  it("Deploy standard token", async() => {
    erc20 = await MyBitToken.new('Dai', 'DAI', tokenSupply);
    console.log(erc20.address);
  });

  it("Spread erc20 to users", async() => {
    let userBalance;
    for (var i = 0; i < tokenHolders.length; i++) {
      //console.log(accounts[i]);
      await erc20.transfer(tokenHolders[i], tokenPerAccount);
      userBalance = bn(await erc20.balanceOf(tokenHolders[i]));
      assert.equal(userBalance.eq(tokenPerAccount), true);
    }
    // Check token ledger is correct
    let totalTokensCirculating = tokenHolders.length * tokenPerAccount;
    let remainingTokens = bn(tokenSupply).minus(totalTokensCirculating);
    let ledgerTrue = bn(await erc20.balanceOf(owner)).eq(remainingTokens);
    assert.equal(ledgerTrue, true);
  });

  it('Deploy Minter', async() => {
    minter = await Minter.new(db.address);
    await cm.addContract("Minter", minter.address);
  });

  it('Deploy CrowdsaleReserve', async() => {
    crowdsaleReserve = await CrowdsaleReserve.new(db.address, events.address);
    await cm.addContract("CrowdsaleReserve", crowdsaleReserve.address);
  });

  it('Deploy EscrowReserve', async() => {
    escrowReserve = await EscrowReserve.new(db.address, events.address);
    await cm.addContract("EscrowReserve", escrowReserve.address);
  });

  it('Deploy CrowdsaleGenerator', async() => {
    crowdsaleGen = await CrowdsaleGenerator.new(db.address, events.address, kyber.address);
    await cm.addContract("CrowdsaleGenerator", crowdsaleGen.address);
  });

  it('Deploy crowdsale contract', async() => {
    crowdsale = await Crowdsale.new(db.address, events.address, kyber.address);
    await cm.addContract('CrowdsaleERC20', crowdsale.address);
    await cm.addContract('Owner', owner); //Right now some database functions are operated from owner account
  });

  it('Deploy operators', async() => {
    operators = await Operators.new(db.address, events.address);
    await cm.addContract('Operators', operators.address);
  });

  it('Set operator', async() => {
    let block = await web3.eth.getBlock('latest');
    await operators.registerOperator(operator, 'Operator', 'Asset Type');
    let logs = await events.getPastEvents('LogOperator', {filter: {messageID: web3.utils.sha3('Operator registered'), origin: owner}, fromBlock: block.number});
    operatorID = logs[0].args.operatorID;
    await operators.acceptERC20Token(operatorID, erc20.address, true, {from: operator});
    await operators.acceptEther(operatorID, true, {from: operator});
  });

  //Start successful funding
  it('Start funding', async() => {
    assetURI = 'ipfs.io/F3b2854A9';
    assetManagerFee = 5;
    let block = await web3.eth.getBlock('latest');
    await platformToken.approve(crowdsaleGen.address, 10, {from:assetManager});
    await crowdsaleGen.createAssetOrderERC20(assetURI, assetManager, operatorID, 100, 0, bn(20).times(ETH).toString(), assetManagerFee, 10, erc20.address, platformToken.address, {from:assetManager});
    let logs = await events.getPastEvents('LogAsset', {filter: {messageID: web3.utils.sha3('Asset funding started'), manager: assetManager}, fromBlock: block.number});
    assetAddress = logs[0].args.asset;
    console.log('Asset Address: ' + assetAddress);
    assetToken = await AssetToken.at(assetAddress);
  });

  it('User1 funding', async() => {
    await erc20.approve(crowdsale.address, bn(5).times(ETH).times(1.03).toString(), {from:user1});
    await crowdsale.buyAssetOrderERC20(assetAddress, user1, bn(5).times(ETH).times(1.03).toString(), erc20.address, {from:user1});
    let user1AssetTokens = bn(await assetToken.balanceOf(user1));
    console.log('Asset Address: ' + assetToken.address);
    console.log('User: ' + user1);
    console.log('User asset tokens: ' + user1AssetTokens.toNumber());

    let assetTokenSupply = await assetToken.totalSupply()
    console.log('assetToken Supply: ' + assetTokenSupply);
    assert.equal(user1AssetTokens.eq(bn(5).times(ETH)), true);
  });

  it('Asset already exists fail', async() => {
    let err;
    let assetManagerFee = 2;
    //Fail because asset already exists
    try{
      await crowdsaleGen.createAssetOrderERC20(assetURI, assetManager, operatorID, 10, 0, bn(20).times(ETH), assetManagerFee, 0, erc20.address, platformToken.address, {from:assetManager});
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('User2 funding', async() => {
    console.log(user2);
    await erc20.approve(crowdsale.address, bn(15).times(ETH).times(1.03).toString(), {from:user2});
    await crowdsale.buyAssetOrderERC20(assetAddress, user2, bn(15).times(ETH).times(1.03).toString(), erc20.address, {from:user2});
    let user2AssetTokens = bn(await assetToken.balanceOf(user2));
    console.log(user2AssetTokens.toNumber());
    assert.equal(user2AssetTokens.eq(bn(15).times(ETH)), true);
  });

  it('User3 funding fail', async() => {
    //Funding finished
    let err;
    try{
      await erc20.approve(crowdsale.address, bn(5).times(ETH).times(1.03).toString(), {from:user3});
      await crowdsale.buyAssetOrderERC20(assetAddress, user3, bn(5).times(ETH).times(1.03).toString(), erc20.address, {from:user3});
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('Fail to withdraw, platform address not set', async() => {
    let err;
    try{
      await crowdsale.payoutERC20(assetAddress);
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('Set platform', async() => {
    await platform.setPlatformWallet(owner);
  });

  it('Fail to set platform wallet', async() => {
    let err;
    try{
      await platform.setPlatformWallet(assetManager, {from:assetManager});
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('Withdraw payout', async() => {
    reserveBalance = await erc20.balanceOf(crowdsaleReserve.address);
    console.log('Reserve: ', bn(reserveBalance).toString());
    ownerBalanceBefore = await erc20.balanceOf(owner);
    operatorBalanceBefore = await erc20.balanceOf(operator);
    await crowdsale.payoutERC20(assetAddress);
    ownerBalanceAfter = await erc20.balanceOf(owner);
    assert.equal(bn(ownerBalanceAfter).minus(ownerBalanceBefore).isEqualTo(bn(ETH).times(20).times(0.03)), true);
    operatorBalanceAfter = await erc20.balanceOf(operator);
    assert.equal(bn(operatorBalanceAfter).minus(operatorBalanceBefore).isEqualTo(bn(ETH).times(20)), true);
  })

  it('Fail to refund', async() => {
    let err;
    try{
      await crowdsale.refund(assetAddress, {from:assetManager});
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('Fail to withdraw, already paid out', async() => {
    let err;
    try{
      await crowdsale.payoutERC20(assetAddress);
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('Test dividends', async() => {
    operatorBalanceBefore = await erc20.balanceOf(operator);
    console.log(Number(operatorBalanceBefore));
    await erc20.approve(assetToken.address, ETH, {from:operator});
    await assetToken.issueDividends(ETH, {from: operator});
    operatorBalanceAfter = await erc20.balanceOf(operator);
    console.log(Number(bn(operatorBalanceAfter).minus(operatorBalanceBefore).plus(bn(ETH).multipliedBy(10))));
  });

  it('User1 withdraw dividends', async() => {
    user1BalanceBefore = await erc20.balanceOf(user1);
    await assetToken.withdraw({from:user1});
    user1BalanceAfter = await erc20.balanceOf(user1);
    assert.equal(bn(user1BalanceAfter).isGreaterThan(user1BalanceBefore), true);
  });

  it('User2 withdraw dividends', async() => {
    user2BalanceBefore = await erc20.balanceOf(user2);
    await assetToken.withdraw({from:user2});
    user2BalanceAfter = await erc20.balanceOf(user2);
    assert.equal(bn(user2BalanceAfter).isGreaterThan(user2BalanceBefore), true);
  });

  it('Asset Manager withdraw dividends', async() => {
    managerBalanceBefore = await erc20.balanceOf(assetManager);
    await assetManagerFunds.withdraw(assetAddress, assetManager, {from:assetManager});
    managerBalanceAfter = await erc20.balanceOf(assetManager);
    assert.equal(bn(managerBalanceAfter).isGreaterThan(managerBalanceBefore), true);
  });

  //Start failed funding
  it('Start failed funding', async() => {
    let err;

    await operators.removeOperator(operatorID);
    assetURI = 'Fail: No operator';
    assetManagerFee = 10;
    try{
      await crowdsaleGen.createAssetOrderERC20(assetURI, assetManager, operatorID, 10, 0, bn(20).times(ETH), assetManagerFee, 0, erc20.address, platformToken.address, {from:assetManager});
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('Set operator', async() => {
    let block = await web3.eth.getBlock('latest');
    await operators.registerOperator(operator, 'Operator', 'Asset Type');
    let logs = await events.getPastEvents('LogOperator', {filter: {messageID: web3.utils.sha3('Operator registered'), origin: owner}, fromBlock: block.number});
    operatorID = logs[0].args.operatorID;
    await operators.acceptERC20Token(operatorID, erc20.address, true, {from: operator});
    await operators.acceptEther(operatorID, true, {from: operator});
  });

  it('Start funding that does not reach goal', async() => {
    assetURI = 'Goooooooaaallllllll';
    assetManagerFee = 20;
    let block = await web3.eth.getBlock('latest');
    await crowdsaleGen.createAssetOrderERC20(assetURI, assetManager, operatorID, 1, 0, bn(20).times(ETH), assetManagerFee, 0, erc20.address, platformToken.address, {from:assetManager});
    let logs = await events.getPastEvents('LogAsset', {filter: {messageID: web3.utils.sha3('Asset funding started'), manager: assetManager}, fromBlock: block.number});
    assetAddress = logs[0].args.asset;
    assetToken = await AssetToken.at(assetAddress);
  });

  it('User3 funding', async() => {
    await erc20.approve(crowdsale.address, bn(5).times(ETH).times(1.03).toString(), {from:user3});
    await crowdsale.buyAssetOrderERC20(assetAddress, user3, bn(5).times(ETH).times(1.03).toString(), erc20.address, {from:user3});
    let user3assetTokens = bn(await assetToken.balanceOf(user3));
    assert.equal(user3assetTokens.eq(bn(5).times(ETH)), true);
  });

  // TODO: this isn't failing as it should
  it('User1 funding fail', async() => {
    web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [3], id: 0
    }, function(){
      console.log('Move forward in time');
    });

    let err;
    try{
      await erc20.approve(crowdsale.address, bn(5).times(ETH).times(1.03).toString(), {from:user1});
      await crowdsale.buyAssetOrderERC20(assetAddress, user1, bn(5).times(ETH).times(1.03).toString(), erc20.address, {from:user1});
    } catch(e){
      err = e;
    }
    // assert.notEqual(err, undefined);
  });

  it('Pause contract', async() => {
    await pausible.pause(crowdsale.address);
  });

  it('Fail to refund: paused', async() => {
    let err;
    try{
      await crowdsale.refund(assetAddress, {from:user3});
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('Unpause contract', async() => {
    await pausible.unpause(crowdsale.address);
  });

  it('Refund', async() => {
    let totalassetTokens = await assetToken.totalSupply();
    user3BalanceBefore = await erc20.balanceOf(user3);
    await crowdsale.refund(assetAddress);
    await assetToken.withdraw({from:user3});
    user3BalanceAfter = await erc20.balanceOf(user3);
    assert.equal(bn(user3BalanceAfter).isGreaterThan(user3BalanceBefore), true);
  });

  // start funding with 0 assetmanager fee
  it('Start funding with no fee', async() => {
    assetURI = 'ipfs.io/F3b285ABA9';
    assetManagerFee = 0;
    let block = await web3.eth.getBlock('latest');
    await crowdsaleGen.createAssetOrderERC20(assetURI, assetManager, operatorID, 100, 0, bn(2).times(ETH).toString(), assetManagerFee, 0, erc20.address, platformToken.address, {from:assetManager});
    let logs = await events.getPastEvents('LogAsset', {filter: {messageID: web3.utils.sha3('Asset funding started'), manager: assetManager}, fromBlock: block.number});
    assetAddress = logs[0].args.asset;
    console.log('Asset Address: ' + assetAddress);
    assetToken = await AssetToken.at(assetAddress);
  });

  it('Fully fund no fee asset', async() => {
    await erc20.approve(crowdsale.address, bn(2).times(ETH).times(1.03).toString(), {from:user1});
    let platformWalletBalance = await erc20.balanceOf(owner);
    await crowdsale.buyAssetOrderERC20(assetAddress, user1, bn(2).times(ETH).times(1.03).toString(), erc20.address, {from:user1});
    await crowdsale.payoutERC20(assetAddress);
    let user1AssetTokens = bn(await assetToken.balanceOf(user1));
    let assetTokenSupply = bn(await assetToken.totalSupply());
    assert.equal(assetTokenSupply.eq(user1AssetTokens), true);
    assert.equal(user1AssetTokens.eq(bn(2).times(ETH)), true);
    //assert.equal(await assetToken.mintingFinished(), true);
    assert.equal(bn(await assetToken.balanceOf(assetManager)).eq(0), true);
    assert.equal(await api.crowdsaleFinalized(assetAddress), true);
    // Check payout to platform and operator
    console.log(platformWalletBalance);
    console.log(await erc20.balanceOf(owner));
    // assert.equal(bn(platformWalletBalance).gt(await erc20.balanceOf(owner)), true);
  });

  it('Fail to create asset with 0 amount to raise', async() => {
    let err;
    assetURI = 'ipfs.io/F3b285ABCA9';
    assetManagerFee = 12;
    try{
      await await crowdsaleGen.createAssetOrderERC20(assetURI, assetManager, operatorID, 100, 0, 0, assetManagerFee, 0, erc20.address, platformToken.address, {from:assetManager});
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  /*
  it('Fail to destroy', async() => {
    let err;
    try{
      await crowdsale.destroy({from:user3});
    } catch(e){
      err = e;
    }
    assert.notEqual(err, undefined);
  });

  it('Destroy', async() => {
    await crowdsale.destroy();
  });
  */

});
