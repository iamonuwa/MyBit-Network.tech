pragma solidity ^0.4.15;
import './SafeMath.sol';
import './DateTime.sol';




	/*
		Token Locking;
				- Transfer tokens into tocken lockTokens
				- event of Transfer
				- call into lockedTokens to update ledger how much was sent in
				- how long they want it locked for
				- transfer back
	*/


contract LockedTokens{
using SafeMath for *;

	DateTime dateTime = new DateTime();



	modifier requiresEther() {
		require(msg.value > 0);
		_;
	}


	modifier hasLocked(){
		require(userLocked[msg.sender]);
		_;
	}

	modifier settlePaymentsRequired() {

	}

	enum Stages {
		LockingTokens,
		SuccessfulLocking,
		FailedLocking,
		Payout
	}

	struct Lock {
		uint256 periodIndex; 	//What type of lock
 	  uint256 amountLocked;
	  uint256 dateLocked;
	  uint256 multiplier;
	  uint256 userIndex;   // indicates its index within all of the users lockedTokens
		uint256 lockIndex;   // Integer of lock(the funds will stay in the old lock until withdrawn)
	}

	//----Epoch time values----//
	uint256 public year;
	uint256 public month;
	uint256 public day;
	uint256 public hour;

	//------------ Dates ----------//
	uint256 public creationDate;
	uint256 public checkEvery5DaysCycle;
	uint256[] public unlockDates;

	modifier lockingPeriodEndedValidation() {
		if(block.timestamp >= (checkEvery5DaysCycle - 25 minutes) &&
			block.timestamp <= (checkEvery5DaysCycle.add(25 minutes))){
				for(uint period =0; period<3;period++){
					if(block.timestamp >= unlockDates[period]){
						settlePayments(period);
					}
				}
			}
	}


	//-----User variables-----//
	mapping (address => bool) public userLocked;
	mapping (address => bool[]) public userPeriodsLocked;
	mapping (address => Lock[]) public userLocks;
	mapping (address => uint256) public userIndex;
	mapping (address => uint256) public balanceOf;
	mapping (uint256 => uint256) public dayUsersLocked;
	uint256 public totalUsersLocked;

	//-----Payout Info------//
	uint256[] public multipliers;
	mapping (uint256 => uint256) balanceOfPeriodTransactionFee;

	//----Count of period contracts created----//
	mapping (uint256 => uint256) public periodContractCount;

	//----Token Contract----//
	//CSToken public tokenContract;
	address public tokenContractAddress;

	//----Testing Variables----//
	mapping (address => uint256) balanceOfUser;
	uint256 public transactionFeePer45Days;

// TODO; only do every 5 days


	//----Events----//
	event TokensLocked(address _user, uint256 _amount, uint256 _period, uint256 _multiplier);


	//--Constructor--//
	function LockedTokens(uint256 amount) public payable {
		creationDate == block.timestamp;
		multipliers = [667, 1334, 2668, 5336]; // 45, 1334, 2668, 5336
		unlockDates = [creationDate.add(45 days), creationDate.add(90 days), creationDate.add(180 days), creationDate.add(360 days)];
		checkEvery5DaysCycle = creationDate.add(5 days);
	}


	function lockTokens(uint256 _period, uint256 _amount) public payable returns(bool){
		require(_amount > 0);
		require(balanceOf[msg.sender] >= _amount);
		require(_period == 0 || _period == 1 || _period == 2 || _period == 3);
		require(msg.sender != address(0));
		require(userLocks[msg.sender][_period].dateLocked == 0);

		uint256 currentTimeStamp = block.timestamp;
		uint256 daysInCycleWhenLocked = (unlockDates[_period] - currentTimeStamp) / day;
		uint256 multiplierForDays =  1-((daysInCycleWhenLocked-1).div(90).mul((1 + multipliers[_period])));

	  userLocks[msg.sender][_period] = Lock(
			{periodIndex:_period,
			 amountLocked:_amount,
			 dateLocked:currentTimeStamp,
			 multiplier: multiplierForDays,
			 userIndex: totalUsersLocked,
			 lockIndex : periodContractCount[_period]
		 });

		periodContractCount[_period].add(1);
		userIndex[msg.sender] = totalUsersLocked;
		dayUsersLocked[_period].add(1);
		userLocks[msg.sender][_period].dateLocked = block.timestamp;
		userPeriodsLocked[msg.sender][_period] = true;

		if(userLocked[msg.sender] != true){
			totalUsersLocked.add(1);
		}

		TokensLocked(msg.sender,_amount,_period, multiplierForDays);
	}

	function receiveTransactionFee(uint256 _amount) public payable returns(bool){
		balanceOfPeriodTransactionFee[0].add(msg.value.mul((1+multipliers[0])));
		balanceOfPeriodTransactionFee[1].add(msg.value.mul((1+multipliers[1])));
		balanceOfPeriodTransactionFee[2].add(msg.value.mul((1+multipliers[2])));
		balanceOfPeriodTransactionFee[3].add(msg.value.mul((1+multipliers[3])));
	}

	function settlePayments(uint256 _period) hasLocked requiresEther public returns(bool){
		isPeriodLocker(_period);
	}

	function withdrawTransactionFee() hasLocked public returns(bool){
	}

	function withdrawLockedTokens(uint256 _period) requiresEther hasLocked public returns(bool){
	}


	//----Validation---//
	function isPeriodLocker(uint256 _period)
	 hasLocked
	 public
	 returns(bool)
	 {
		 return userPeriodsLocked[msg.sender][_period];
	 }

	function hasPeriodGotBalance(uint256 _period)
	hasLocked
	public
	returns(bool)
	{
		isPeriodLocker(_period);
		if(balanceOfPeriodTransactionFee[_period] > 0){return true;}
		return false;
	}




	//-----Getters-----//
	function getDay45UnlockDate() constant public returns(uint256){
		return unlockDates[0];
	}

	function getDay90UnlockDate() constant public returns(uint256){
		return unlockDates[1];
	}

	function getDay180UnlockDate() constant public returns(uint256){
		return  unlockDates[2];
	}

	function getDay360UnlockDate() constant public returns(uint256){
		return  unlockDates[3];
	}



	function() public payable{
		revert();
	}


}
