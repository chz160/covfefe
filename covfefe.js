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
        election.broadcast = function (data) { this.getInstance().broadcast(data); };
        election.messageSlaves = function (data) { this.getInstance().messageSlaves(data); };
        election.messageMaster = function (data) { this.getInstance().messageMaster(data); };
        election.message = function (message) { this.getInstance().message(message); };
        election.setMessageHandlerCallback = function (callback) { this.getInstance().setMessageHandlerCallback(callback); };
        election.setExceptionHandlerCallback = function (callback) { this.getInstance().setExceptionHandlerCallback(callback); };
        return election;
    }());
    covfefe.election = election;
    var electionBase = (function () {
        function electionBase() {
            this._keyPrefix = "covfefe";
            this._messageKey = this._keyPrefix + ".message";
            this._reportAsSiblingKey = this._keyPrefix + ".reportAsSiblings";
            this._removeFromSiblingsKey = this._keyPrefix + ".removeFromSiblings";
            this._startElectionKey = this._keyPrefix + ".startElection";
            this._castVoteKey = this._keyPrefix + ".castVote";
            this._siblingHeartbeatInterval = 5000;
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
            if (debug === true) {
                this.startDebugging();
            }
            tbob.serviceBus.listenFor(this._messageKey, this.onMessage);
            this.startSiblingHandshake();
        };
        electionBase.prototype.broadcast = function (data) {
            var allWindowIds = this._siblingWindows
                .map(function (s) {
                return s.windowId;
            });
            if (allWindowIds.length > 0) {
                this.message(new message(this._windowId, allWindowIds, data));
            }
        };
        electionBase.prototype.messageSlaves = function (data) {
            var slaveWindowIds = this._siblingWindows
                .filter(function (sw) { return sw.isMaster !== true; })
                .map(function (s) {
                return s.windowId;
            });
            if (slaveWindowIds.length > 0) {
                this.message(new message(this._windowId, slaveWindowIds, data));
            }
        };
        electionBase.prototype.messageMaster = function (data) {
            var masterWindowIds = this._siblingWindows
                .filter(function (sw) { return sw.isMaster === true; })
                .map(function (s) {
                return s.windowId;
            });
            if (masterWindowIds.length > 0) {
                this.message(new message(this._windowId, masterWindowIds, data));
            }
        };
        electionBase.prototype.message = function (message) {
            tbob.serviceBus.fireEvent(this._messageKey, message, false);
        };
        electionBase.prototype.setMessageHandlerCallback = function (callback) {
            this._messageHandler = callback;
        };
        electionBase.prototype.setExceptionHandlerCallback = function (callback) {
            this._exceptionHandler = callback;
        };
        electionBase.prototype.onMessage = function (message) {
            var _this = this;
            if (this._messageHandler != null &&
                message.sender != this._windowId &&
                message.recipients.some(function (r) { return r === _this._windowId; })) {
                this._messageHandler(message.data);
                this.log(JSON.stringify(message));
            }
        };
        electionBase.prototype.startSiblingHandshake = function () {
            var _this = this;
            tbob.serviceBus.listenFor(this._reportAsSiblingKey, function (sibling) {
                if (sibling.windowId != _this._windowId) {
                    if (!_this.siblingArrayContains(_this._siblingWindows, sibling.windowId)) {
                        _this._siblingWindows.push(sibling);
                        tbob.serviceBus.fireEvent(_this._reportAsSiblingKey, new siblingWindow(_this._windowId, _this._isMaster, _this._openedTimestamp, _this.timestamp()), false);
                        _this.log(JSON.stringify(sibling));
                    }
                }
            });
            tbob.serviceBus.listenFor(this._removeFromSiblingsKey, function (windowId) {
                if (windowId != _this._windowId) {
                    var index = _this.siblingArrayIndexOf(_this._siblingWindows, windowId);
                    if (index !== -1) {
                        _this._siblingWindows.splice(index, 1);
                    }
                    _this.log(windowId);
                }
            });
            tbob.serviceBus.listenFor(this._startElectionKey, function () {
                if (_this._electionActive == false) {
                    _this._electionActive = true;
                    var vote = _this.getOldestSibling();
                    tbob.serviceBus.fireEvent(_this._castVoteKey, vote, false);
                    setTimeout(function () {
                        _this.inaugurateWinner();
                        _this._electionActive = false;
                        _this._votes.length = 0;
                    }, _this._electionTimeout);
                }
            });
            tbob.serviceBus.listenFor(this._castVoteKey, function (vote) {
                _this._votes.push(vote);
                _this.log(JSON.stringify(vote));
            });
            $(window).on("beforeunload", function () {
                clearTimeout(_this._siblingHeartbeat);
                tbob.serviceBus.fireEvent(_this._removeFromSiblingsKey, _this._windowId, false);
                if (_this._isMaster === true) {
                    tbob.serviceBus.fireEvent(_this._startElectionKey, null, true);
                }
            });
            clearTimeout(this._siblingHeartbeat);
            tbob.serviceBus.fireEvent(this._reportAsSiblingKey, new siblingWindow(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), false);
            this._siblingHeartbeat = setInterval(function () {
                tbob.serviceBus.fireEvent(_this._reportAsSiblingKey, new siblingWindow(_this._windowId, _this._isMaster, _this._openedTimestamp, _this.timestamp()), false);
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
        electionBase.prototype.handleException = function (error) {
            this._exceptionHandler(error);
        };
        electionBase.prototype.siblingArrayContains = function (array, value) {
            return this._siblingWindows.some(function (sw) { return sw.windowId == value; });
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
                return a.openedTimestamp - b.openedTimestamp;
            });
            return sortedList.length == 0 ? this._windowId : (this._openedTimestamp < sortedList[0].openedTimestamp ? this._windowId : sortedList[0].windowId);
        };
        electionBase.prototype.inaugurateWinner = function () {
            var winningVote = this.majorityVote(this._votes);
            if (winningVote == null) {
                this.demandRevote();
            }
            else if (winningVote === this._windowId) {
                this.becomeMaster();
            }
            else {
                this._siblingWindows.filter(function (sw) { return sw.windowId === winningVote; }).forEach(function (sw) { return sw.isMaster = true; });
                this._siblingWindows.filter(function (sw) { return sw.windowId !== winningVote; }).forEach(function (sw) { return sw.isMaster = false; });
                this.becomeSlave();
            }
        };
        electionBase.prototype.demandRevote = function () {
        };
        electionBase.prototype.becomeMaster = function () {
            this._isMaster = true;
            this.messageSlaves("I AM THE MASTER!!!");
        };
        electionBase.prototype.becomeSlave = function () {
            this._isMaster = false;
            this.messageSlaves("we are slaves.");
        };
        electionBase.prototype.majorityVote = function (votes) {
            if (votes.length == 0 || !votes.every(function (v) { return v == votes[0]; }))
                return null;
            var votesSortedByInstances = votes.sort(function (a, b) { return votes.filter(function (v1) { return v1 === b; }).length - votes.filter(function (v2) { return v2 === a; }).length; });
            return votesSortedByInstances[0];
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
        electionBase.prototype.startDebugging = function () {
            var _this = this;
            document.addEventListener("DOMContentLoaded", function (event) {
                var div = document.createElement("div");
                div.style.cssText = "position:absolute; bottom: 10px; right: 10px; width: 95%; height: 150px; padding:5px; background-color:white; border: 1px solid black; opacity: 0.5; z-index:100; overflow-x: hidden;overflow-y: auto;";
                _this._debugDiv = div;
                document.getElementsByTagName('body')[0].appendChild(_this._debugDiv);
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
                var debugText = JSON.stringify({ me: new siblingWindow(this._windowId, this._isMaster, this._openedTimestamp, null), siblings: this._siblingWindows });
                if (message != null) {
                    debugText = message;
                }
                console.log("covfefe: " + debugText);
                if (this._debugDiv != null) {
                    this._debugDiv.innerHTML = "<pre><code class=\"language-json\">" + debugText + "</code></pre>";
                }
            }
        };
        return electionBase;
    }());
    var message = (function () {
        function message(sender, recipients, data) {
            this.sender = sender;
            this.recipients = recipients;
            this.data = data;
            this.timestamp = +new Date();
        }
        return message;
    }());
    covfefe.message = message;
    var siblingWindow = (function () {
        function siblingWindow(w, m, ot, lht) {
            this.windowId = w;
            this.isMaster = m;
            this.openedTimestamp = ot;
            this.lastHandshakeTimestamp = lht;
        }
        return siblingWindow;
    }());
})(covfefe || (covfefe = {}));
//# sourceMappingURL=covfefe.js.map