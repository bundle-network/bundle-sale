const { ether } = require('./helpers/ether'),
  { gwei } = require('./helpers/gwei'),
  { advanceBlock } = require('./helpers/advanceToBlock'),
  { duration } = require('./helpers/duration'),
  { increaseTimeTo } = require('./helpers/increaseTimeTo'),
  { latestTime } = require('./helpers/latestTime'),
  EVMThrow = require('./helpers/EVMThrow');

const BigNumber = web3.BigNumber;

const should = require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should();

const Token = artifacts.require('BundleToken');

contract('BundleToken', function([deployer, wallet, foundation, investor, investor2, investor3]) {
  const unit = new BigNumber(10 ** 18);
  const tokenRate = new BigNumber(5000);
  const cap = ether(70);
  const softCap = ether(20);
  const softCapTime = duration.hours(120);
  const lessThanCap = ether(50);
  const lessThanSoftCap = ether(10);
  const minContribution = ether(0.1);
  const minPreSaleContribution = ether(20);
  const expectedTokenAmount = tokenRate.mul(cap);

  before(async function() {
    //Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
    await advanceBlock();
  });

  beforeEach(async function() {
    this.preSaleStartTime = latestTime() + duration.days(5);
    this.preSaleEndTime = this.preSaleStartTime + duration.weeks(4);
    this.crowdsaleStartTime = this.preSaleEndTime + duration.days(1);
    this.crowdsaleEndTime = this.crowdsaleStartTime + duration.weeks(4);

    this.token = await Token.new(
      wallet,
      softCap,
      cap,
      this.preSaleStartTime,
      this.preSaleEndTime,
      this.crowdsaleStartTime,
      this.crowdsaleEndTime
    );
  });

  describe('creating a valid token', function() {
    it('should fail if cap smaller than softCap', async function() {
      await Token.new(
        wallet,
        cap,
        softCap,
        this.preSaleStartTime,
        this.preSaleEndTime,
        this.crowdsaleStartTime,
        this.crowdsaleEndTime
      ).should.be.rejectedWith(EVMThrow);
    });

    it('should fail with invalid date times', async function() {
      const startTime = latestTime();

      await Token.new(
        wallet,
        softCap,
        cap,
        startTime,
        startTime - duration.weeks(4),
        startTime,
        startTime + duration.weeks(4)
      ).should.be.rejectedWith(EVMThrow);
    });
  });

  describe('whitelist', function() {
    it('should allow to add or delete from the whitelist', async function() {
      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      let added = await this.token.whitelist(investor);
      added.should.equal(true);

      await this.token.setWhitelist([], [investor]).should.be.fulfilled;

      let deleted = await this.token.whitelist(investor);
      deleted.should.equal(false);
    });
  });

  describe('bonus & tokens', function() {
    it('should return correct bonus rates for exact amount of ether', async function() {
      let weiAmount1 = ether(15);
      let bonusRate1 = await this.token.calculateBonusRate(weiAmount1);
      bonusRate1.should.be.bignumber.equal(125);

      let weiAmount2 = ether(10);
      let bonusRate2 = await this.token.calculateBonusRate(weiAmount2);
      bonusRate2.should.be.bignumber.equal(115);

      let weiAmount3 = ether(5);
      let bonusRate3 = await this.token.calculateBonusRate(weiAmount3);
      bonusRate3.should.be.bignumber.equal(105);

      let weiAmount4 = ether(2);
      let bonusRate4 = await this.token.calculateBonusRate(weiAmount4);
      bonusRate4.should.be.bignumber.equal(100);
    });

    it('should return tokens with calculated bonus value', async function() {
      let weiAmount1 = ether(0.1);
      let bonusRate1 = 100;
      let actual1 = await this.token.calculateTokens(weiAmount1);
      let expected1 = weiAmount1
        .mul(bonusRate1)
        .div(100)
        .mul(tokenRate);

      actual1.should.be.bignumber.equal(expected1);

      let weiAmount2 = ether(15);
      let bonusRate2 = 125;
      let actual2 = await this.token.calculateTokens(weiAmount2);
      let expected2 = weiAmount2
        .mul(bonusRate2)
        .div(100)
        .mul(tokenRate);

      actual2.should.be.bignumber.equal(expected2);
    });
  });

  describe('accepting payments', function() {
    it('should reject payments before start', async function() {
      await this.token.send(minContribution, { from: investor }).should.be.rejectedWith(EVMThrow);
      await this.token.buyTokens(investor, { value: minContribution }).should.be.rejectedWith(EVMThrow);
    });

    it('should reject payments if investor not in whitelist', async function() {
      await increaseTimeTo(this.crowdsaleStartTime);

      await this.token.send(minContribution, { from: investor }).should.be.rejectedWith(EVMThrow);
      await this.token.buyTokens(investor, { value: minContribution }).should.be.rejectedWith(EVMThrow);
    });

    it('should reject payments smaller than min contribution', async function() {
      await increaseTimeTo(this.crowdsaleStartTime);

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.send(minContribution.minus(1), { from: investor }).should.be.rejectedWith(EVMThrow);
      await this.token.buyTokens(investor, { value: minContribution.minus(1) }).should.be.rejectedWith(EVMThrow);
    });

    it('should accept payments after start', async function() {
      await increaseTimeTo(this.crowdsaleStartTime);

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.buy({ from: investor, value: minContribution }).should.be.fulfilled;
    });

    it('should be correct values after token sold', async function() {
      await increaseTimeTo(this.crowdsaleStartTime);

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.buy({ from: investor, value: minContribution }).should.be.fulfilled;

      let balanceOfInvestor = await this.token.balanceOf(investor);
      let etherRaised = await this.token.getEtherRaised();
      let tokenSold = await this.token.getTokenSold();

      balanceOfInvestor.should.be.bignumber.equal(minContribution.mul(tokenRate));
      etherRaised.should.be.bignumber.equal(minContribution);
      tokenSold.should.be.bignumber.equal(minContribution.mul(tokenRate));
    });
  });

  describe('halt', function() {
    it('should reject payments when ico halted', async function() {
      this.token.halt();

      await this.token.send(minContribution, { from: investor }).should.be.rejectedWith(EVMThrow);
      await this.token.buyTokens(investor, { value: minContribution }).should.be.rejectedWith(EVMThrow);
    });

    it('should accept payments after ico unhalted', async function() {
      this.token.halt();

      await this.token.send(minContribution, { from: investor }).should.be.rejectedWith(EVMThrow);
      await this.token.buyTokens(investor, { value: minContribution }).should.be.rejectedWith(EVMThrow);

      this.token.unhalt();

      await increaseTimeTo(this.crowdsaleStartTime);

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.buy({ from: investor, value: minContribution }).should.be.fulfilled;
    });
  });

  describe('accepting payments with fiat', function() {
    it('should reject contribution before pre crowdsale', async function() {
      await increaseTimeTo(latestTime() + duration.days(2));

      await this.token.buyTokensWithFiat(investor, minPreSaleContribution, 110).should.be.rejectedWith(EVMThrow);
    });

    it('should reject payments if investor not in whitelist', async function() {
      await increaseTimeTo(this.preSaleStartTime);

      await this.token.buyTokensWithFiat(investor, minPreSaleContribution, 110).should.be.rejectedWith(EVMThrow);
    });

    it('should reject payments smaller than min pre sale contribution', async function() {
      await increaseTimeTo(this.preSaleStartTime);

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.buyTokensWithFiat(investor, minContribution, 110).should.be.rejectedWith(EVMThrow);
    });

    it('should reject bonus smaller or equal 100', async function() {
      await increaseTimeTo(this.preSaleStartTime);

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.buyTokensWithFiat(investor, minPreSaleContribution, 100).should.be.rejectedWith(EVMThrow);
    });

    it('should reject if sold more than token sale amount', async function() {
      await increaseTimeTo(this.preSaleStartTime);

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.buyTokensWithFiat(investor, ether(25500.01), 200).should.be.rejectedWith(EVMThrow);
    });

    it('should accept payment and be correct values after token sold with fiat', async function() {
      const contribution = ether(20);
      const bonusRate = 120;
      await increaseTimeTo(this.preSaleStartTime);

      let totalSupplyB = await this.token.totalSupply.call();

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.buyTokensWithFiat(investor, contribution, bonusRate).should.be.fulfilled;

      let totalSupplyA = await this.token.totalSupply.call();

      let balanceOfInvestor = await this.token.balanceOf(investor);
      let etherRaised = await this.token.getEtherRaised();
      let tokenSold = await this.token.getTokenSold();

      balanceOfInvestor.should.be.bignumber.equal(
        contribution
          .mul(bonusRate)
          .div(100)
          .mul(tokenRate)
      );
      etherRaised.should.be.bignumber.equal(contribution);
      tokenSold.should.be.bignumber.equal(
        contribution
          .mul(bonusRate)
          .div(100)
          .mul(tokenRate)
      );
      totalSupplyA.should.be.bignumber.equal(totalSupplyB.add(balanceOfInvestor));
    });
  });

  describe('lockups periods', function() {
    it('should be correct lockup periods for tokens without token sale', async function() {
      let balance = await this.token.balanceOf(deployer);
      let period = await this.token.getLockupPeriod(deployer);
      let releasedTokenAmount = await this.token.getLockupReleasedTokenAmount(deployer);
      let totalTokenAmount = await this.token.getLockupTotalTokenAmount(deployer);
      let releasableTokens = await this.token.getLockupReleasableTokens(deployer);
      let isLocked = await this.token.getLockupIsLocked(deployer);

      period.should.be.bignumber.equal(5);
      releasedTokenAmount.should.be.bignumber.equal(0);
      totalTokenAmount.should.be.bignumber.equal(balance);
      isLocked.should.equal(true);

      releasableTokens[0].should.be.bignumber.equal(ether(49 * 10 ** 6));
      releasableTokens[1].should.be.bignumber.equal(ether(49 * 10 ** 6));
      releasableTokens[2].should.be.bignumber.equal(ether(49 * 10 ** 6));
      releasableTokens[3].should.be.bignumber.equal(ether(49 * 10 ** 6));
      releasableTokens[4].should.be.bignumber.equal(ether(49 * 10 ** 6));
    });

    it('should be correct lockup periods when buy with fiat', async function() {
      const contribution = ether(20);
      const bonusRate = 120;
      await increaseTimeTo(this.preSaleStartTime);

      await this.token.setWhitelist([investor], []).should.be.fulfilled;

      await this.token.buyTokensWithFiat(investor, contribution, bonusRate).should.be.fulfilled;

      let balanceOfInvestor = await this.token.balanceOf(investor);
      let period = await this.token.getLockupPeriod(investor);
      let releasedTokenAmount = await this.token.getLockupReleasedTokenAmount(investor);
      let totalTokenAmount = await this.token.getLockupTotalTokenAmount(investor);
      let releasableTokens = await this.token.getLockupReleasableTokens(investor);
      let isLocked = await this.token.getLockupIsLocked(investor);

      period.should.be.bignumber.equal(1);
      releasedTokenAmount.should.be.bignumber.equal(0);
      totalTokenAmount.should.be.bignumber.equal(balanceOfInvestor);
      isLocked.should.equal(true);
      releasableTokens[0].should.be.bignumber.equal(ether(20 * 5000));
      releasableTokens[1].should.be.bignumber.equal(ether(20 * 5000 * 0.2));
    });
  });

  describe('transfer', function() {
    it('should not be transfer bonus tokens before period complete', async function() {
      const contribution = ether(20);
      const bonusRate = 120;

      await increaseTimeTo(this.preSaleStartTime);

      await this.token.setWhitelist([investor2, investor3], []).should.be.fulfilled;

      await this.token.buyTokensWithFiat(investor2, contribution, bonusRate).should.be.fulfilled;

      await increaseTimeTo(this.crowdsaleEndTime + duration.days(2 * 30) + duration.seconds(1));

      await this.token
        .transfer(investor3, 20 * 5000 * 1.2 * unit, { from: investor2 })
        .should.be.rejectedWith(EVMThrow);

      const isLocked = await this.token.getLockupIsLocked(investor2);
      const balanceOfInvestor3 = await this.token.balanceOf(investor3);

      balanceOfInvestor3.should.be.bignumber.equal(0);

      isLocked.should.equal(true);
    });

    it('should be transfer all tokens when period completed', async function() {
      const contribution = ether(20);
      const bonusRate = 120;

      await increaseTimeTo(this.preSaleStartTime);

      await this.token.setWhitelist([investor, investor2], []).should.be.fulfilled;

      await this.token.buyTokensWithFiat(investor, contribution, bonusRate).should.be.fulfilled;

      await increaseTimeTo(this.crowdsaleEndTime + duration.days(5 * 30) + duration.seconds(1));

      await this.token.transfer(investor2, 20 * 5000 * 1.2, { from: investor }).should.be.fulfilled;

      const isLocked = await this.token.getLockupIsLocked(investor);

      let balanceOfInvestor2 = await this.token.balanceOf(investor2);

      balanceOfInvestor2.should.be.bignumber.equal(20 * 5000 * 1.2);

      isLocked.should.equal(false);
    });

    it('should be transfer company tokens when every period', async function() {
      const contribution = ether(20);
      const bonusRate = 120;

      await increaseTimeTo(this.crowdsaleEndTime + duration.seconds(1));
      await this.token.transfer(investor3, 49 * 10 ** 6 * unit, { from: deployer }).should.be.fulfilled;
      await this.token.transfer(investor3, 1 * 10 ** 6 * unit, { from: deployer }).should.be.rejectedWith(EVMThrow);

      var releasedTokenAmount = await this.token.getLockupReleasedTokenAmount(deployer);
      releasedTokenAmount.should.be.bignumber.equal(49 * 10 ** 6 * 1 * unit);

      await increaseTimeTo(this.crowdsaleEndTime + duration.days(5 * 30 * 1) + duration.seconds(1));
      await this.token.transfer(investor3, 49 * 10 ** 6 * unit, { from: deployer }).should.be.fulfilled;
      await this.token.transfer(investor3, 1 * 10 ** 6 * unit, { from: deployer }).should.be.rejectedWith(EVMThrow);

      releasedTokenAmount = await this.token.getLockupReleasedTokenAmount(deployer);
      releasedTokenAmount.should.be.bignumber.equal(49 * 10 ** 6 * 2 * unit);

      await increaseTimeTo(this.crowdsaleEndTime + duration.days(5 * 30 * 2) + duration.seconds(1));
      await this.token.transfer(investor3, 49 * 10 ** 6 * unit, { from: deployer }).should.be.fulfilled;
      await this.token.transfer(investor3, 1 * 10 ** 6 * unit, { from: deployer }).should.be.rejectedWith(EVMThrow);

      releasedTokenAmount = await this.token.getLockupReleasedTokenAmount(deployer);
      releasedTokenAmount.should.be.bignumber.equal(49 * 10 ** 6 * 3 * unit);

      await increaseTimeTo(this.crowdsaleEndTime + duration.days(5 * 30 * 3) + duration.seconds(1));
      await this.token.transfer(investor3, 49 * 10 ** 6 * unit, { from: deployer }).should.be.fulfilled;
      await this.token.transfer(investor3, 1 * 10 ** 6 * unit, { from: deployer }).should.be.rejectedWith(EVMThrow);

      releasedTokenAmount = await this.token.getLockupReleasedTokenAmount(deployer);
      releasedTokenAmount.should.be.bignumber.equal(49 * 10 ** 6 * 4 * unit);

      await increaseTimeTo(this.crowdsaleEndTime + duration.days(5 * 30 * 4) + duration.seconds(1));
      await this.token.transfer(investor3, 49 * 10 ** 6 * unit, { from: deployer }).should.be.fulfilled;
      await this.token.transfer(investor3, 1 * 10 ** 6 * unit, { from: deployer }).should.be.rejectedWith(EVMThrow);

      releasedTokenAmount = await this.token.getLockupReleasedTokenAmount(deployer);
      releasedTokenAmount.should.be.bignumber.equal(49 * 10 ** 6 * 5 * unit);

      let balance = await this.token.balanceOf(investor3);

      balance.should.be.bignumber.equal(245 * 10 ** 6 * unit);
    });
  });
});
