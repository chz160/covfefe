module covfefe {
    export class election {
        private static instance: electionBase;
        static getInstance(): electionBase {
            if (this.instance == undefined) {
                this.instance = new electionBase();
            }
            return this.instance;
        }

        static init(debug: boolean = false) { this.getInstance().init(debug); }
        static setExceptionHandlerCallback(callback: Function) { this.getInstance().setExceptionHandlerCallback(callback); }
    }

    class electionBase {
        private _windowId: string;
        private _openedTimestamp: number;
        private _reportAsSiblingKey: string = "covfefe.reportAsSiblings";
        private _removeFromSiblingsKey: string = "covfefe.removeFromSiblings";
        private _startElectionKey: string = "covfefe.startElection";
        private _castVoteKey: string = "covfefe.castVote";
        private _exceptionHandler: Function;
        private _siblingHeartbeatInterval: number = 1000;
        private _siblingHeartbeat: number;
        private _siblingWindows: Array<siblingParam> = [];
        private _siblingTimeout: number = 30000;

        private _checkForMasterTimeout: number = 2000;
        private _electionActive: boolean = false;
        private _electionTimeout: number = 5000;
        private _votes: Array<string> = [];

        private _isMaster: boolean = false;

        private _debug: boolean = false;

        constructor() {
            if (tbob == undefined) throw "2browsers1bus is a dependant library of covfefe. Please include it in your application."
            this._windowId = this.newGuid();
            this._openedTimestamp = this.timestamp();
        }

        init(debug: boolean) {
            this._debug = debug;
            this.startSiblingHandshake();
        }

        private startSiblingHandshake() {
            tbob.serviceBus.listenFor(this._reportAsSiblingKey, (sibling: siblingParam) => {
                if (sibling.windowId != this._windowId) {
                    if (!this.siblingArrayContains(this._siblingWindows, sibling.windowId)) {
                        this._siblingWindows.push(sibling)
                        tbob.serviceBus.fireEvent(this._reportAsSiblingKey, new siblingParam(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), true)
                        this.log();
                    }
                }
            });

            tbob.serviceBus.listenFor(this._removeFromSiblingsKey, (windowId: string) => {
                if (windowId != this._windowId) {
                    var index = this.siblingArrayIndexOf(this._siblingWindows, windowId);
                    if (index !== -1) { this._siblingWindows.splice(index, 1); }
                    this.log();
                }
            });

            tbob.serviceBus.listenFor(this._startElectionKey, () => {
                if (this._electionActive == false) {
                    this._electionActive = true;
                    var vote = this.getOldestSibling();
                    tbob.serviceBus.fireEvent(this._castVoteKey, vote, true)
                    setTimeout(() => {
                        this.inaugurateWinner();
                        this._electionActive = false
                        this._votes.length = 0;
                    }, this._electionTimeout)
                }
            });

            tbob.serviceBus.listenFor(this._castVoteKey, (vote: string) => {
                this._votes.push(vote)
            });

            $(window).on("beforeunload", () => {
                clearTimeout(this._siblingHeartbeat);
                tbob.serviceBus.fireEvent(this._removeFromSiblingsKey, this._windowId, true)
                if (this._isMaster === true) {
                    tbob.serviceBus.fireEvent(this._startElectionKey, null, true);
                }
            });

            clearTimeout(this._siblingHeartbeat);
            tbob.serviceBus.fireEvent(this._reportAsSiblingKey, new siblingParam(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), true)
            this._siblingHeartbeat = setInterval(() => {
                tbob.serviceBus.fireEvent(this._reportAsSiblingKey, new siblingParam(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), true)
                setTimeout(() => {
                    if (this._isMaster == false) {
                        if (this._siblingWindows.length > 0) {
                            if (!this.checkLocalForMasterSibling()) {
                                tbob.serviceBus.fireEvent(this._startElectionKey, null, true)
                            }
                        } else {
                            this._isMaster = true;
                        }
                    }
                }, this._checkForMasterTimeout)
            }, this._siblingHeartbeatInterval);
        }

        setExceptionHandlerCallback(callback: Function): void {
            this._exceptionHandler = callback;
        }

        private handleException(e: Error): void {
            this._exceptionHandler(e);
        }

        private siblingArrayContains(array: Array<siblingParam>, value: string): boolean {
            return this.siblingArrayIndexOf(array, value) >= 0;
        }

        private siblingArrayIndexOf(array: Array<siblingParam>, value: string): number {
            let result = -1;
            if (array != null && array.length > 0 && value != null) {
                for (let i = 0; i < array.length; i++) {
                    if (array[i].windowId === value) {
                        result = i;
                        break;
                    }
                }
            }
            return result;
        }

        private getMasterSibling(): siblingParam {
            let result: siblingParam = null;
            if (this._siblingWindows.length > 0) {
                for (let i = 0; i < this._siblingWindows.length; i++) {
                    if (this._siblingWindows[i].isMaster === true) {
                        result = this._siblingWindows[i];
                        break;
                    }
                }
            }
            return result;
        }

        private checkLocalForMasterSibling(): boolean {
            return this.getMasterSibling() != null ? true : false;
        }

        private getOldestSibling(): string {
            const sortedList = this._siblingWindows.sort(function (a, b) {
                return b.openedTimestamp - a.openedTimestamp;
            });
            return sortedList.length > 0 ? (this._openedTimestamp > sortedList[0].openedTimestamp ? sortedList[0].windowId : sortedList[0].windowId) : this._windowId;
        }

        private inaugurateWinner(): void {
            const winningVote = this.mode(this._votes);
            if (winningVote === this._windowId) {
                this._isMaster = true;
            }
            else {
                var matches = this._siblingWindows.filter(sw => sw.windowId == winningVote);
                if (matches.length > 0) {
                    matches[0].isMaster = true;
                }
            }
        }

        private mode(array) {
            return array.sort((a, b) => array.filter(v => v === a).length - array.filter(v => v === b).length).pop();
        }

        private timestamp(): number {
            return +new Date();
        }

        private newGuid(): string {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
                var r = Math.random() * 16 | 0, v = c == "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        
        private logError(e): void {
            if (window.console && window.console.log && e != null && e.message) {
                console.log(e.message);
                if (this.handleException != null) {
                    this.handleException(e);
                }
            }
        }

        private log(message: string = null): void {
            if (this._debug) {
                if (message != null) {
                    console.log(`covfefe: ${message}`)
                } else {
                    console.log(`covfefe: ${JSON.stringify({ me: new siblingParam(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), siblings: this._siblingWindows })}`)
                }
            }
        }
    }

    class siblingParam {
        constructor(w: string, m: boolean, ot: number, lht: number) {
            this.windowId = w;
            this.isMaster = m;
            this.openedTimestamp = ot;
            this.lastHandshakeTimestamp = lht;
        }

        public windowId: string;
        public isMaster: boolean;
        public openedTimestamp: number;
        public lastHandshakeTimestamp: number;
    }
}