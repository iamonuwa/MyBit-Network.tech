pragma solidity ^0.4.24;

import "../math/SafeMath.sol";
import "../interfaces/ERC20.sol";
import "../interfaces/MinterInterface.sol";
import "../interfaces/CrowdsaleReserveInterface.sol";

interface Events {  function transaction(string _message, address _from, address _to, uint _amount, address _token)  external; }
interface DB {
  function addressStorage(bytes32 _key) external view returns (address);
  function uintStorage(bytes32 _key) external view returns (uint);
  function setUint(bytes32 _key, uint _value) external;
  function deleteUint(bytes32 _key) external;
  function setBool(bytes32 _key, bool _value) external;
  function boolStorage(bytes32 _key) external view returns (bool);
}

// @title An asset crowdsale contract, which accepts Ether for funding.
// @author Kyle Dewhurst & Peter Phillips, MyBit Foundation
// @notice Starts a new crowdsale and returns asset dividend tokens for Wei received.
// @dev The AssetManager
contract CrowdsaleETH {
    using SafeMath for uint256;

    DB private database;
    Events private events;
    MinterInterface private minter;
    CrowdsaleReserveInterface private reserve;

    // @notice Constructor: Initiates the database
    // @param: The address for the database contract
    constructor(address _database, address _events)
    public {
      database = DB(_database);
      events = Events(_events);
      minter = MinterInterface(database.addressStorage(keccak256(abi.encodePacked("contract", "Minter"))));
      reserve = CrowdsaleReserveInterface(database.addressStorage(keccak256(abi.encodePacked("contract", "CrowdsaleReserve"))));
    }


    // @notice Investors can send Ether here to fund asset, receiving an equivalent number of asset-tokens.
    // @param (bytes32) _assetAddress = The address of the asset which completed the crowdsale
    function buyAssetOrderETH(address _assetAddress)
    external
    payable
    requiresEther
    validAsset(_assetAddress)
    beforeDeadline(_assetAddress)
    notFinalized(_assetAddress)
    returns (bool) {
      uint fundingRemaining = database.uintStorage(keccak256(abi.encodePacked("crowdsale.remaining", _assetAddress)));
      uint amount; //The number of tokens that will be minted
      if (msg.value < fundingRemaining) {
        amount = msg.value.mul(100).div(uint(100).add(database.uintStorage(keccak256(abi.encodePacked("platform.fee")))));
        database.setUint(keccak256(abi.encodePacked("crowdsale.remaining", _assetAddress)), fundingRemaining.sub(msg.value));
        //Mint tokens equal to the msg.value
        require(minter.mintAssetTokens(_assetAddress, msg.sender, amount), "Investor minting failed");
        reserve.receiveETH.value(msg.value)(msg.sender);
      } else {
        amount = fundingRemaining.mul(100).div(uint(100).add(database.uintStorage(keccak256(abi.encodePacked("platform.fee")))));
        //Funding complete, finalize crowdsale
        database.setBool(keccak256(abi.encodePacked("crowdsale.finalized", _assetAddress)), true);
        database.deleteUint(keccak256(abi.encodePacked("crowdsale.remaining", _assetAddress)));
        //Since investor paid equal to or over the funding remaining, just mint for tokensRemaining
        require(minter.mintAssetTokens(_assetAddress, msg.sender, amount), "Investor minting failed");
        reserve.receiveETH.value(fundingRemaining)(msg.sender);
        //Return leftover WEI after cost of tokens calculated and subtracted from msg.value to msg.sender
        msg.sender.transfer(msg.value.sub(fundingRemaining));
      }
      events.transaction('Asset purchased', address(this), msg.sender, amount, _assetAddress);

      return true;
    }

    // @notice This is called once funding has succeeded. Sends Ether to a distribution contract where receiver & assetManager can withdraw
    // @dev The contract manager needs to know  the address PlatformDistribution contract
    // @param (bytes32) _assetAddress = The address of the asset which completed the crowdsale
    function payoutETH(address _assetAddress)
    external
    whenNotPaused
    finalized(_assetAddress)
    notPaid(_assetAddress)
    returns (bool) {
      //Set paid to true
      database.setBool(keccak256(abi.encodePacked("crowdsale.paid", _assetAddress)), true);
      //Setup token
      //Mint tokens for the asset manager and platform + finish minting
      address platformAssetsWallet = database.addressStorage(keccak256(abi.encodePacked("platform.wallet.assets")));
      require(platformAssetsWallet != address(0), "Platform assets wallet not set");
      require(minter.mintAssetTokens(_assetAddress, database.addressStorage(keccak256(abi.encodePacked("contract", "AssetManagerFunds"))), database.uintStorage(keccak256(abi.encodePacked("asset.managerTokens", _assetAddress)))), "Manager minting failed");
      require(minter.mintAssetTokens(_assetAddress, platformAssetsWallet, database.uintStorage(keccak256(abi.encodePacked("asset.platformTokens", _assetAddress)))), "Platform minting failed");
      //Get the addresses for the receiver and platform
      address receiver = database.addressStorage(keccak256(abi.encodePacked("asset.manager", _assetAddress)));
      address platformFundsWallet = database.addressStorage(keccak256(abi.encodePacked("platform.wallet.funds")));
      require(receiver != address(0) && platformFundsWallet != address(0), "Receiver or platform wallet not set");
      //Calculate amounts for platform and receiver
      uint amount = database.uintStorage(keccak256(abi.encodePacked("crowdsale.goal", _assetAddress)));
      uint platformFee = amount.getFractionalAmount(database.uintStorage(keccak256(abi.encodePacked("platform.fee"))));
      //Transfer funds to receiver and platform
      require(reserve.issueETH(platformFundsWallet, platformFee), 'Platform funds not paid');
      require(reserve.issueETH(receiver, amount), 'Operator funds not paid');
      //Delete crowdsale start time
      database.deleteUint(keccak256(abi.encodePacked("crowdsale.start", _assetAddress)));
      //Increase asset count for manager
      address manager = database.addressStorage(keccak256(abi.encodePacked("asset.manager", _assetAddress)));
      database.setUint(keccak256(abi.encodePacked("manager.assets", manager)), database.uintStorage(keccak256(abi.encodePacked("manager.assets", manager))).add(1));
      //Emit event
      events.transaction('Asset payout', _assetAddress, receiver, amount, address(0));
      return true;
    }

    function cancel(address _assetAddress)
    external
    whenNotPaused
    validAsset(_assetAddress)
    beforeDeadline(_assetAddress)
    notFinalized(_assetAddress)
    returns (bool){
      require(msg.sender == database.addressStorage(keccak256(abi.encodePacked("asset.manager", _assetAddress))));
      database.setUint(keccak256(abi.encodePacked("crowdsale.deadline", _assetAddress)), 1);
      refund(_assetAddress);
    }

    // @notice Contributors can retrieve their funds here if crowdsale has paased deadline and not reached its goal
    // @param (bytes32) _assetAddress = The address of the asset which completed the crowdsale
    function refund(address _assetAddress)
    public
    whenNotPaused
    validAsset(_assetAddress)
    afterDeadline(_assetAddress)
    notFinalized(_assetAddress)
    returns (bool) {
      require(database.uintStorage(keccak256(abi.encodePacked("crowdsale.deadline", _assetAddress))) != 0);
      database.deleteUint(keccak256(abi.encodePacked("crowdsale.deadline", _assetAddress)));
      ERC20 assetToken = ERC20(_assetAddress);
      uint refundValue = assetToken.totalSupply().mul(uint(100).add(database.uintStorage(keccak256(abi.encodePacked("platform.fee"))))).div(100); //total supply plus platform fees
      reserve.refundETHAsset(_assetAddress, refundValue);
      return true;
    }

    // @notice platform owners can recover tokens here
    function recoverTokens(address _erc20Token)
    onlyOwner
    external {
      ERC20 thisToken = ERC20(_erc20Token);
      uint contractBalance = thisToken.balanceOf(address(this));
      thisToken.transfer(msg.sender, contractBalance);
    }

    // @notice platform owners can destroy contract here
    function destroy()
    onlyOwner
    external {
      events.transaction('CrowdsaleETH destroyed', address(this), msg.sender, address(this).balance, address(0));
      selfdestruct(msg.sender);
    }

    //------------------------------------------------------------------------------------------------------------------
    //                                            Modifiers
    //------------------------------------------------------------------------------------------------------------------


    // @notice Requires that Ether is sent with the transaction
    modifier requiresEther() {
      require(msg.value > 0);
      _;
    }

    // @notice Sender must be a registered owner
    modifier onlyOwner {
      require(database.boolStorage(keccak256(abi.encodePacked("owner", msg.sender))), "Not owner");
      _;
    }

    // @notice function won't run if owners have paused this contract
    modifier whenNotPaused {
      require(!database.boolStorage(keccak256(abi.encodePacked("paused", address(this)))), "Contract paused");
      _;
    }

    // @notice reverts if the asset does not have a token address set in the database
    modifier validAsset(address _assetAddress) {
      require(database.addressStorage(keccak256(abi.encodePacked("asset.manager", _assetAddress))) != address(0), "Invalid asset");
      _;
    }

    // @notice reverts if the funding deadline has not passed
    modifier beforeDeadline(address _assetAddress) {
      require(now < database.uintStorage(keccak256(abi.encodePacked("crowdsale.deadline", _assetAddress))), "Before deadline");
      _;
    }

    // @notice reverts if the funding deadline has already past or crowsale has not started
    modifier betweenDeadlines(address _assetAddress) {
      require(now <= database.uintStorage(keccak256(abi.encodePacked("crowdsale.deadline", _assetAddress))), "Past deadline");
      require(now >= database.uintStorage(keccak256(abi.encodePacked("crowdsale.start", _assetAddress))), "Before start time");
      _;
    }

    // @notice reverts if the funding deadline has already past
    modifier afterDeadline(address _assetAddress) {
      require(now > database.uintStorage(keccak256(abi.encodePacked("crowdsale.deadline", _assetAddress))), "Before deadline");
      _;
    }

    // @notice returns true if crowdsale is finshed
    modifier finalized(address _assetAddress) {
      require( database.boolStorage(keccak256(abi.encodePacked("crowdsale.finalized", _assetAddress))), "Crowdsale not finalized");
      _;
    }

    // @notice returns true if crowdsale is not finshed
    modifier notFinalized(address _assetAddress) {
      require( !database.boolStorage(keccak256(abi.encodePacked("crowdsale.finalized", _assetAddress))), "Crowdsale finalized");
      _;
    }

    // @notice returns true if crowdsale has not paid out
    modifier notPaid(address _assetAddress) {
      require( !database.boolStorage(keccak256(abi.encodePacked("crowdsale.paid", _assetAddress))), "Crowdsale had paid out");
      _;
    }

  }
