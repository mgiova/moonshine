
var sys = require ('sys'),
		
	// Constants
	LUA_TNIL = 0,
	LUA_TBOOLEAN = 1,
	LUA_TNUMBER = 3,
	LUA_TSTRING = 4;




function Parser () {
	this._data = null;
	this._pointer = null;
	this._tree = null;
}




Parser.prototype.parse = function (filename, callback) {

	var me = this,
		fs = require ('fs');
	
	fs.readFile (filename, 'binary', function (err, data) {
		if (err) throw err;
		
		me._data = '' + data;
		me._pointer = 0;
	
		me._readGlobalHeader ();	
		me._tree = me._readChunk ();
		
		if (callback) callback (me._tree);
	});
}




Parser.prototype.getTree = function () {
	return this._tree;
};




/* --------------------------------------------------
 * Parse input file
 * -------------------------------------------------- */


Parser.prototype._readGlobalHeader = function () {

	this._config = {
		signature: this._readByte (4),
		version: this._readByte ().toString (16).split ('', 2).join ('.'),
		formatVersion: this._readByte (),
		endianess: this._readByte (),

		sizes: {
			int: this._readByte (),
			size_t: this._readByte (),
			instruction: this._readByte (),
			number: this._readByte (),
		},
		
		integral: this._readByte ()
	};
		
	
	// sys.print ('Header Signature: ' + this._config.signature.substr (1, 3));
	// sys.print ('\nVersion: ' + this._config.version);
	// sys.print ('\nFormat verison: ' + this._config.formatVersion);
	// sys.print ('\nEndianness: ' + (this._config.endianess? 'little' : 'big') + '-endian');
	// sys.print ('\nSize of int: ' + this._config.sizes.int);
	// sys.print ('\nSize of size_t: ' + this._config.sizes.size_t);
	// sys.print ('\nSize of Instruction: ' + this._config.sizes.instruction);
	// sys.print ('\nSize of a Lua number: ' + this._config.sizes.number);
	// sys.print ('\nIntegral flag: ' + this._config.integral);
};




Parser.prototype._readByte = function (length) {
	if (length === undefined) return this._data.charCodeAt (this._pointer++);
	
	length = length || 1;
	return this._data.substr ((this._pointer += length) - length, length);
};




Parser.prototype._readString = function () {
	
	var length = this._readByte (this._config.sizes.size_t).charCodeAt (0),		
		result = length? this._readByte (length) : '',
		pos = result.indexOf (String.fromCharCode (0));

	if (pos >= 0) result = result.substr (0, pos);
	return result;
};




Parser.prototype._readInteger = function () {
	var b = this._readByte (this._config.sizes.int),
		bin = '';
	
	for (var i = 0, l = b.length; i < l; i++) bin = ('0' + b.charCodeAt (i).toString (16)).substr (-2) + bin;	// NOTE: Beware of endianess
	return parseInt (bin, 16);
};




Parser.prototype._readNumber = function () {

	// Double precision floating-point format
	//	http://en.wikipedia.org/wiki/Double_precision_floating-point_format
	//	http://babbage.cs.qc.edu/IEEE-754/Decimal.html

	var number = this._readByte (this._config.sizes.number),
		data = '';
	
	for (var i = 0, l = number.length; i < l; i++) {
		data = ('0000000' + number.charCodeAt (i).toString (2)).substr (-8) + data;	// Beware: may need to be different for other endianess
	}

	var sign = parseInt (data.substr (-64, 1), 2),
		exponent = parseInt (data.substr (-63, 11), 2),
		mantissa = Parser.binFractionToDec (data.substr (-52, 52), 2);

	if (exponent === 0) return 0;
	if (exponent === 2047) return Infinity;

	return Math.pow (-1, sign) * (1 + mantissa) * Math.pow (2, exponent - 1023);
};




Parser.binFractionToDec = function (mantissa) {
	var result = 0;
	
	for (var i = 0, l = mantissa.length; i < l; i++) {
		if (mantissa.substr (i, 1) === '1') result += 1 / Math.pow (2, i + 1);
	}

	return result;
};




Parser.prototype._readInstruction = function () {
	return this._readByte (this._config.sizes.instruction);
};




Parser.prototype._readConstant = function () {
	var type = this._readByte ();

	switch (type) {
		case LUA_TNIL: 		return;
		case LUA_TBOOLEAN: 	return !!this._readByte ();
		case LUA_TNUMBER: 	return this._readNumber ();
		case LUA_TSTRING: 	return this._readString ();

		default: throw new Error ('Unknown constant type.');
	}
};




Parser.prototype._readInstructionList = function () {
	
	var length = this._readInteger (),
		result = [],
		index;
	
	for (index = 0; index < length; index++) result.push (this._readInstruction ());	
	return result;
};




Parser.prototype._readConstantList = function () {
	
	var length = this._readInteger (),
		result = [],
		index;
	
	for (index = 0; index < length; index++) result.push (this._readConstant ());

	return result;
};




Parser.prototype._readFunctionList = function () {
	
	var length = this._readInteger (),
		result = [],
		index;

	for (index = 0; index < length; index++) result.push (this._readChunk ());
	return result;
};




Parser.prototype._readStringList = function () {
	
	var length = this._readInteger (),
		result = [],
		index;

	for (index = 0; index < length; index++) result.push (this._readString ());
	return result;
};




Parser.prototype._readIntegerList = function () {
	
	var length = this._readInteger (),
		result = [],
		index;

	for (index = 0; index < length; index++) result.push (this._readInteger ());
	return result;
};




Parser.prototype._readLocalsList = function () {
	
	var length = this._readInteger (),
		result = [],
		index;

	for (index = 0; index < length; index++) {
		result.push ({
			varname: this._readString (),
			startpc: this._readInteger (),
			endpc: this._readInteger ()
		});
	}
	
	return result;
};




Parser.prototype._readChunk = function () {
	
	var result = {
		sourceName: this._readString (),
		lineDefined: this._readInteger (),
		lastLineDefined: this._readInteger (),
		upvalueCount: this._readByte (),
		paramCount: this._readByte (),
		is_vararg: this._readByte (),
		maxStackSize: this._readByte (),
		instructions: this._parseInstructions (this._readInstructionList ()),
		constants: this._readConstantList (),
		functions: this._readFunctionList (),
		linePositions: this._readIntegerList (),
		locals: this._readLocalsList (),
		upvalues: this._readStringList ()
	};
	
	return result;
};




Parser.prototype._parseInstructions = function (instructions) {
	var result = [];
	for (var i = 0, l = instructions.length; i < l; i++) result.push (this._parseInstruction (instructions[i]));	
	return result;
};




Parser.prototype._parseInstruction = function (instruction) {
	var data = '',
		result = {};
	
	for (var i = 0, l = instruction.length; i < l; i++) {
		data = ('0000000' + instruction.charCodeAt (i).toString (2)).substr (-8) + data;	// Beware: may need to be different for other endianess
	}

	//sys.print (data + '\n');
	result.opcode = parseInt (data.substr (-6), 2);
	result.A = parseInt (data.substr (-14, 8), 2);

	switch (result.opcode) {
		
		// iABx
		case 1: //loadk
		case 5: //getglobal
		case 7: //setglobal
		case 36: //closure
			result.B = parseInt (data.substr (-32, 18), 2);
			break;

		// iAsBx
		case 22: //jmp
		case 31: //forloop
		case 32: //forprep
			result.B = parseInt (data.substr (-32, 18), 2) - 131071;
			break;
					
		// iABC
		default:
			result.B = parseInt (data.substr (-32, 9), 2);
			result.C = parseInt (data.substr (-23, 9), 2);
	}
	
	return result;
};




exports.Parser = Parser;
