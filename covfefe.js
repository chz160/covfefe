var covfefe;
(function (covfefe) {
    var election = (function () {
        function election() {
        }
        election.getInstance = function () {
            if (this.instance == undefined) {
                this.instance = new electionBase();
            }
            return this.instance;
        };
        election.init = function (debug) {
            if (debug === void 0) { debug = false; }
            this.getInstance().init(debug);
        };
        election.setExceptionHandlerCallback = function (callback) { this.getInstance().setExceptionHandlerCallback(callback); };
        return election;
    }());
    covfefe.election = election;
    var electionBase = (function () {
        function electionBase() {
            this._reportAsSiblingKey = "covfefe.reportAsSiblings";
            this._removeFromSiblingsKey = "covfefe.removeFromSiblings";
            this._startElectionKey = "covfefe.startElection";
            this._castVoteKey = "covfefe.castVote";
            this._siblingHeartbeatInterval = 1000;
            this._siblingWindows = [];
            this._siblingTimeout = 30000;
            this._checkForMasterTimeout = 2000;
            this._electionActive = false;
            this._electionTimeout = 5000;
            this._votes = [];
            this._isMaster = false;
            this._debug = false;
            if (tbob == undefined)
                throw "2browsers1bus is a dependant library of covfefe. Please include it in your application.";
            this._windowId = this.newGuid();
            this._openedTimestamp = this.timestamp();
        }
        electionBase.prototype.init = function (debug) {
            this._debug = debug;
            this.startSiblingHandshake();
        };
        electionBase.prototype.startSiblingHandshake = function () {
            var _this = this;
            tbob.serviceBus.listenFor(this._reportAsSiblingKey, function (sibling) {
                if (sibling.windowId != _this._windowId) {
                    if (!_this.siblingArrayContains(_this._siblingWindows, sibling.windowId)) {
                        _this._siblingWindows.push(sibling);
                        tbob.serviceBus.fireEvent(_this._reportAsSiblingKey, new siblingParam(_this._windowId, _this._isMaster, _this._openedTimestamp, _this.timestamp()), true);
                        _this.log();
                    }
                }
            });
            tbob.serviceBus.listenFor(this._removeFromSiblingsKey, function (windowId) {
                if (windowId != _this._windowId) {
                    var index = _this.siblingArrayIndexOf(_this._siblingWindows, windowId);
                    if (index !== -1) {
                        _this._siblingWindows.splice(index, 1);
                    }
                    _this.log();
                }
            });
            tbob.serviceBus.listenFor(this._startElectionKey, function () {
                if (_this._electionActive == false) {
                    _this._electionActive = true;
                    var vote = _this.getOldestSibling();
                    tbob.serviceBus.fireEvent(_this._castVoteKey, vote, true);
                    setTimeout(function () {
                        _this.inaugurateWinner();
                        _this._electionActive = false;
                        _this._votes.length = 0;
                    }, _this._electionTimeout);
                }
            });
            tbob.serviceBus.listenFor(this._castVoteKey, function (vote) {
                _this._votes.push(vote);
            });
            $(window).on("beforeunload", function () {
                clearTimeout(_this._siblingHeartbeat);
                tbob.serviceBus.fireEvent(_this._removeFromSiblingsKey, _this._windowId, true);
                if (_this._isMaster === true) {
                    tbob.serviceBus.fireEvent(_this._startElectionKey, null, true);
                }
            });
            clearTimeout(this._siblingHeartbeat);
            tbob.serviceBus.fireEvent(this._reportAsSiblingKey, new siblingParam(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), true);
            this._siblingHeartbeat = setInterval(function () {
                tbob.serviceBus.fireEvent(_this._reportAsSiblingKey, new siblingParam(_this._windowId, _this._isMaster, _this._openedTimestamp, _this.timestamp()), true);
                setTimeout(function () {
                    if (_this._isMaster == false) {
                        if (_this._siblingWindows.length > 0) {
                            if (!_this.checkLocalForMasterSibling()) {
                                tbob.serviceBus.fireEvent(_this._startElectionKey, null, true);
                            }
                        }
                        else {
                            _this._isMaster = true;
                        }
                    }
                }, _this._checkForMasterTimeout);
            }, this._siblingHeartbeatInterval);
        };
        electionBase.prototype.setExceptionHandlerCallback = function (callback) {
            this._exceptionHandler = callback;
        };
        electionBase.prototype.handleException = function (e) {
            this._exceptionHandler(e);
        };
        electionBase.prototype.siblingArrayContains = function (array, value) {
            return this.siblingArrayIndexOf(array, value) >= 0;
        };
        electionBase.prototype.siblingArrayIndexOf = function (array, value) {
            var result = -1;
            if (array != null && array.length > 0 && value != null) {
                for (var i = 0; i < array.length; i++) {
                    if (array[i].windowId === value) {
                        result = i;
                        break;
                    }
                }
            }
            return result;
        };
        electionBase.prototype.getMasterSibling = function () {
            var result = null;
            if (this._siblingWindows.length > 0) {
                for (var i = 0; i < this._siblingWindows.length; i++) {
                    if (this._siblingWindows[i].isMaster === true) {
                        result = this._siblingWindows[i];
                        break;
                    }
                }
            }
            return result;
        };
        electionBase.prototype.checkLocalForMasterSibling = function () {
            return this.getMasterSibling() != null ? true : false;
        };
        electionBase.prototype.getOldestSibling = function () {
            var sortedList = this._siblingWindows.sort(function (a, b) {
                return b.openedTimestamp - a.openedTimestamp;
            });
            return sortedList.length > 0 ? (this._openedTimestamp > sortedList[0].openedTimestamp ? sortedList[0].windowId : sortedList[0].windowId) : this._windowId;
        };
        electionBase.prototype.inaugurateWinner = function () {
            var winningVote = this.mode(this._votes);
            if (winningVote === this._windowId) {
                this._isMaster = true;
            }
            else {
                var matches = this._siblingWindows.filter(function (sw) { return sw.windowId == winningVote; });
                if (matches.length > 0) {
                    matches[0].isMaster = true;
                }
            }
        };
        electionBase.prototype.mode = function (array) {
            return array.sort(function (a, b) { return array.filter(function (v) { return v === a; }).length - array.filter(function (v) { return v === b; }).length; }).pop();
        };
        electionBase.prototype.timestamp = function () {
            return +new Date();
        };
        electionBase.prototype.newGuid = function () {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0, v = c == "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        };
        electionBase.prototype.logError = function (e) {
            if (window.console && window.console.log && e != null && e.message) {
                console.log(e.message);
                if (this.handleException != null) {
                    this.handleException(e);
                }
            }
        };
        electionBase.prototype.log = function (message) {
            if (message === void 0) { message = null; }
            if (this._debug) {
                if (message != null) {
                    console.log("covfefe: " + message);
                }
                else {
                    console.log("covfefe: " + JSON.stringify({ me: new siblingParam(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), siblings: this._siblingWindows }));
                }
            }
        };
        return electionBase;
    }());
    var siblingParam = (function () {
        function siblingParam(w, m, ot, lht) {
            this.windowId = w;
            this.isMaster = m;
            this.openedTimestamp = ot;
            this.lastHandshakeTimestamp = lht;
        }
        return siblingParam;
    }());
})(covfefe || (covfefe = {}));
//# sourceMappingURL=covfefe.js.map