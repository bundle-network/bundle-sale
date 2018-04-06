pragma solidity ^0.4.16;

import "./ERC23StandardToken.sol";

// Based in part on code by Open-Zeppelin: https://github.com/OpenZeppelin/zeppelin-solidity.git
// Based in part on code by FirstBlood: https://github.com/Firstbloodio/token/blob/master/smart_contract/FirstBloodToken.sol
contract BundleToken is ERC23StandardToken {

    string public constant name = "Bundle Network Token";
    string public constant symbol = "BND";
    uint256 public constant decimals = 18;
    uint256 public constant tokenRate = 5000;

    address public multisig;
    address public foundation; //owner address
    address public bountyAddress;
    address public airdropAddress;

    uint256 public cap;
    uint256 public softCap;
    uint256 public preSaleStartTime;
    uint256 public preSaleEndTime;
    uint256 public crowdsaleStartTime;
    uint256 public crowdsaleEndTime;

    uint256 public constant DURATION = 5 * 30 days;
    uint256 public minContribution = 0.1 ether;
    uint256 public minPreSaleContribution = 20 ether;

    struct LockUpDetail {
      uint256 period;
      uint256 totalTokenAmount;
      uint256 releasedTokenAmount;
      uint256[] releasableTokens;
      bool isLocked;
    }

    mapping (address => bool) public whitelist;
    mapping (address => uint256) public contributions; //keeps track of ether contributions in Wei of each contributor address
    mapping (address => LockUpDetail) public lockups; // address -> months

    uint256 public constant BUNDLE_UNIT = 10**18;
    uint256 public constant MILLION = 10**6;
    uint256 public constant TOKEN_SALE = 255 * MILLION * BUNDLE_UNIT;
    uint256 public constant TOKEN_TEAM = 100 * MILLION * BUNDLE_UNIT;
    uint256 public constant TOKEN_OPERATIONAL_EXPENCES = 85 * MILLION * BUNDLE_UNIT;
    uint256 public constant TOKEN_MARKETING = 50 * MILLION * BUNDLE_UNIT;
    uint256 public constant TOKEN_BOUNTY = 8 * MILLION * BUNDLE_UNIT;
    uint256 public constant TOKEN_AIRDROP = 2 * MILLION * BUNDLE_UNIT;

    uint256 public crowdsaleTokenSold = 0; //Keeps track of the amount of tokens sold during the crowdsale
    uint256 public etherRaised = 0; //Keeps track of the Ether raised during the crowdsale

    bool public halted = false;

    event Halt();
    event Unhalt();
    event WhitelistAddressAdded(address indexed _whitelister, address indexed _beneficiary);
    event WhitelistAddressRemoved(address indexed _whitelister, address indexed _beneficiary);

    //Constructor: set multisig crowdsale recipient wallet address and fund the foundation
    //Initialize total supply and allocate ecosystem & foundation tokens
  	function BundleToken(
        address _multisig,
        address _bountyAddress,
        address _airdropAddress,
        uint256 _softCap,
        uint256 _cap,
        uint256 _preSaleStartTime,
        uint256 _preSaleEndTime,
        uint256 _crowdsaleStartTime,
        uint256 _crowdsaleEndTime
      ) {
        require(_multisig != address(0));
        require(_bountyAddress != address(0));
        require(_airdropAddress != address(0));
        require(_softCap < _cap);
        require(now < _preSaleStartTime);
        require(_preSaleStartTime < _preSaleEndTime);
        require(_preSaleEndTime < _crowdsaleStartTime);
        require(_crowdsaleStartTime < _crowdsaleEndTime);

        softCap = _softCap;
        cap = _cap;

        multisig = _multisig;
        bountyAddress = _bountyAddress;
        airdropAddress = _airdropAddress;
        preSaleStartTime = _preSaleStartTime;
        preSaleEndTime = _preSaleEndTime;
        crowdsaleStartTime = _crowdsaleStartTime;
        crowdsaleEndTime = _crowdsaleEndTime;

        foundation = msg.sender;
        totalSupply = TOKEN_TEAM.add(TOKEN_OPERATIONAL_EXPENCES).add(TOKEN_MARKETING);
        balances[foundation] = totalSupply;
        balances[bountyAddress] = TOKEN_BOUNTY;
        balances[airdropAddress] = TOKEN_AIRDROP;

        uint256 period = 5;
        lockups[foundation].period = period;
        lockups[foundation].totalTokenAmount = totalSupply;
        lockups[foundation].releasedTokenAmount = 0;
        lockups[foundation].isLocked = true;


        uint256 i = 0;
        for (i = 0; i < period; i++) {
          lockups[foundation].releasableTokens.push(totalSupply.div(period));
        }
  	}

    modifier onlyOwner() {
        require (msg.sender == foundation);
        _;
    }

    modifier whenNotHalted() {
        require(!halted);
        _;
    }

    modifier preCrowdsaleOn() {
        require(now >= preSaleStartTime && now <= preSaleEndTime);
        _;
    }

    modifier crowdsaleOn() {
        require(now >= crowdsaleStartTime && now <= crowdsaleEndTime);
        _;
    }

    modifier crowdsaleEnd() {
        require(now > crowdsaleEndTime);
        _;
    }

    function() payable {
        buy();
    }

    function halt() onlyOwner {
        halted = true;
        Halt();
    }

    function unhalt() onlyOwner {
        halted = false;
        Unhalt();
    }

    function buy() payable {
        buyTokens(msg.sender);
    }

    //Allow addresses to buy token for another account
    function buyTokens(address recipient) public payable whenNotHalted crowdsaleOn {
        require(recipient != address(0));
        require(whitelist[recipient]);
        require(msg.value >= minContribution);

        uint256 tokens = calculateTokens(msg.value);

        require(crowdsaleTokenSold.add(tokens) <= TOKEN_SALE);
        require(etherRaised.add(msg.value) <= cap);

        balances[recipient] = balances[recipient].add(tokens);
        totalSupply = totalSupply.add(tokens);
        etherRaised = etherRaised.add(msg.value);
        contributions[recipient] = contributions[recipient].add(msg.value);
        crowdsaleTokenSold = crowdsaleTokenSold.add(tokens);

        require(multisig.send(msg.value));

        Transfer(this, recipient, tokens);
    }

    //Burns the specified amount of tokens from the foundation
    //Used to burn unspent funds in foundation DAO
    function burn(uint256 _value) external onlyOwner returns (bool) {
        balances[msg.sender] = balances[msg.sender].sub(_value);
        totalSupply = totalSupply.sub(_value);

        Transfer(msg.sender, address(0), _value);

        return true;
    }

    //Allow to change the recipient multisig address
    function setMultisig(address addr) external onlyOwner {
      	require(addr != address(0));

      	multisig = addr;
    }

    function transfer(address _to, uint256 _value, bytes _data) public crowdsaleEnd returns (bool success) {
        require(canTransfer(msg.sender, _value));

        return super.transfer(_to, _value, _data);
    }

	  function transfer(address _to, uint256 _value) public crowdsaleEnd {
        require(canTransfer(msg.sender, _value));

        super.transfer(_to, _value);
	  }

    function transferFrom(address _from, address _to, uint256 _value) public crowdsaleEnd {
        require(canTransfer(msg.sender, _value));

        super.transferFrom(_from, _to, _value);
    }

    function getEtherRaised() external constant returns (uint256) {
        return etherRaised;
    }

    function getTokenSold() external constant returns (uint256) {
        return crowdsaleTokenSold;
    }

    function getLockupPeriod(address addr) public view onlyOwner returns(uint256) {
      return lockups[addr].period;
    }

    function getLockupReleasableTokens(address addr) public view onlyOwner returns(uint256[]) {
      return lockups[addr].releasableTokens;
    }

    function getLockupTotalTokenAmount(address addr) public view onlyOwner returns(uint256) {
      return lockups[addr].totalTokenAmount;
    }

    function getLockupReleasedTokenAmount(address addr) public view onlyOwner returns(uint256) {
      return lockups[addr].releasedTokenAmount;
    }

    function getLockupIsLocked(address addr) public view onlyOwner returns(bool) {
      return lockups[addr].isLocked;
    }

    function setWhitelist(address[] _add, address[] _remove) public onlyOwner {
        uint256 i = 0;

        // adding whitelist addresses
        for (i = 0; i < _add.length; i++) {
            require(_add[i] != address(0));

            if (!whitelist[_add[i]]) {
                whitelist[_add[i]] = true;
                WhitelistAddressAdded(msg.sender, _add[i]);
            }
        }

        // removing whitelist addresses
        for (i = 0; i < _remove.length; i++) {
            require(_remove[i] != address(0));

            if (whitelist[_remove[i]]) {
                whitelist[_remove[i]] = false;
                WhitelistAddressRemoved(msg.sender, _remove[i]);
            }
        }
    }

    function buyTokensWithFiat(address recipient, uint256 contribution, uint256 bonusRate) public onlyOwner preCrowdsaleOn {
      require(recipient != address(0));
      require(whitelist[recipient]);
      require(contribution >= minPreSaleContribution);
      require(bonusRate > 100);

      uint256 tokensWithoutBonus = contribution.mul(tokenRate);
      uint256 tokens = tokensWithoutBonus.mul(bonusRate).div(100);
      require(crowdsaleTokenSold.add(tokens) <= TOKEN_SALE);

      balances[recipient] = balances[recipient].add(tokens);
      totalSupply = totalSupply.add(tokens);
      etherRaised = etherRaised.add(contribution);
      contributions[recipient] = contributions[recipient].add(contribution);
      crowdsaleTokenSold = crowdsaleTokenSold.add(tokens);

      lockups[recipient].period = 1;
      lockups[recipient].totalTokenAmount = balances[recipient];
      lockups[recipient].releasedTokenAmount = 0;

      if (lockups[recipient].releasableTokens.length == 0) {
        lockups[recipient].releasableTokens = new uint256[](2);
      }

      lockups[recipient].releasableTokens[0] = lockups[recipient].releasableTokens[0].add(tokensWithoutBonus);
      lockups[recipient].releasableTokens[1] = lockups[recipient].releasableTokens[1].add(tokens.sub(tokensWithoutBonus));
      lockups[recipient].isLocked = true;

      Transfer(this, recipient, tokens);
    }

    function canTransfer(address recipient, uint256 value) internal returns(bool) {
        uint256 period = lockups[recipient].period;
        bool isLocked = lockups[recipient].isLocked;

        if (isLocked && period > 0) {
          if (now.sub(crowdsaleEndTime) > DURATION.mul(period)) {
            lockups[recipient].isLocked = false;

            return true;
          } else {
            uint256 _days = now.sub(crowdsaleEndTime);
            uint256 _index = 0;

            if (_days >= DURATION.mul(4)) {
                _index = 4;
            } else if (_days >= DURATION.mul(3)) {
                _index = 3;
            } else if (_days >= DURATION.mul(2)) {
                _index = 2;
            } else if (_days >= DURATION.mul(1)) {
                _index = 1;
            }

            uint256 releasedTokenAmount = lockups[recipient].releasedTokenAmount.add(value);
            uint256 releasableTokenAmount = 0;
            uint256 i = 0;
            for (i = 0; i <= _index; i++) {
              releasableTokenAmount = releasableTokenAmount.add(lockups[recipient].releasableTokens[_index]);
            }

            if (releasedTokenAmount > releasableTokenAmount) {
              return false;
            }

            lockups[recipient].releasedTokenAmount = releasedTokenAmount;

            return true;
          }
        }

        return true;
    }

    function calculateBonusRate(uint256 weiAmount) public constant returns(uint256) {
        if (weiAmount >= 15 ether) {
          return 125;
        } else if (weiAmount >= 10 ether) {
          return 115;
        } else if (weiAmount >= 5 ether) {
          return 105;
        } else {
          return 100;
        }
    }

    function calculateTokens(uint256 contribution) public view returns (uint256) {
      uint256 bonusRate = calculateBonusRate(contribution);

      return contribution.mul(bonusRate).div(100).mul(tokenRate);
    }

}
