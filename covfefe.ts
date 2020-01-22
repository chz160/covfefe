//
// # Covfefe
//
module covfefe {
    // The election class contains a singleton of the electionBase class
    // with wrapper methods to access that singletons non-static methods.
    // this is so the using application does not need to maintain an instance
    // of covfefe and any calls made all atct against the same instance.
    export class election {
        private static instance: electionBase;
        static getInstance(): electionBase {
            if (this.instance == undefined) {
                this.instance = new electionBase();
            }
            return this.instance;
        }

        static init(debug: boolean = false): void { this.getInstance().init(debug); }
        static broadcast(data: any): void { this.getInstance().broadcast(data); }
        static messageSlaves(data: any): void { this.getInstance().messageSlaves(data); }
        static messageMaster(data: any): void { this.getInstance().messageMaster(data); }
        static message(message: message): void { this.getInstance().message(message); }
        static setMessageHandlerCallback(callback: OnMessageCallback): void { this.getInstance().setMessageHandlerCallback(callback); }
        static setExceptionHandlerCallback(callback: OnExceptionCallback): void { this.getInstance().setExceptionHandlerCallback(callback); }
    }

    type OnMessageCallback = (message: message) => void;
    type OnExceptionCallback = (error: Error) => void;

    class electionBase {
        private _windowId: string;
        private _openedTimestamp: number;
        private _keyPrefix = "covfefe";
        private _messageKey: string = `${this._keyPrefix}.message`;
        private _reportAsSiblingKey: string = `${this._keyPrefix}.reportAsSiblings`;
        private _removeFromSiblingsKey: string = `${this._keyPrefix}.removeFromSiblings`;
        private _startElectionKey: string = `${this._keyPrefix}.startElection`;
        private _castVoteKey: string = `${this._keyPrefix}.castVote`;
        private _exceptionHandler: OnExceptionCallback;
        private _messageHandler: OnMessageCallback;
        private _siblingHeartbeatInterval: number = 5000;
        private _siblingHeartbeat: number;
        private _siblingWindows: Array<siblingWindow> = [];
        private _siblingTimeout: number = 30000; //TODO: remove sibling from list if it hasn't communicated in an amount of time.

        private _checkForMasterTimeout: number = 2000;
        private _electionActive: boolean = false;
        private _electionTimeout: number = 5000;
        private _votes: Array<string> = [];

        private _isMaster: boolean = false;

        private _debug: boolean = false;
        private _debugDiv: HTMLElement;

        constructor() {
            if (tbob == undefined) throw "2browsers1bus is a dependant library of covfefe. Please include it in your application."
            this._windowId = this.newGuid();
            this._openedTimestamp = this.timestamp();
        }

        init(debug: boolean) {
            this._debug = debug;
            if (debug === true) {
                this.startDebugging();
            }
            tbob.serviceBus.listenFor(this._messageKey, this.onMessage)
            this.startSiblingHandshake();
        }

        broadcast(data: any): void {
            const allWindowIds = this._siblingWindows
                .map((s: siblingWindow) => {
                    return s.windowId;
                });
            if (allWindowIds.length > 0) {
                this.message(new message(this._windowId, allWindowIds, data));
            }
        }

        messageSlaves(data: any): void {
            const slaveWindowIds = this._siblingWindows
                .filter(sw => sw.isMaster !== true)
                .map((s: siblingWindow) => {
                    return s.windowId;
                });
            if (slaveWindowIds.length > 0) {
                this.message(new message(this._windowId, slaveWindowIds, data));
            }
        }

        messageMaster(data: any): void {
            const masterWindowIds = this._siblingWindows
                .filter(sw => sw.isMaster === true)
                .map((s: siblingWindow) => {
                    return s.windowId;
                });
            if (masterWindowIds.length > 0) {
                this.message(new message(this._windowId, masterWindowIds, data));
            }
        }

        message(message: message): void {
            tbob.serviceBus.fireEvent(this._messageKey, message, false);
        }

        setMessageHandlerCallback(callback: OnMessageCallback): void {
            this._messageHandler = callback;
        }

        setExceptionHandlerCallback(callback: OnExceptionCallback): void {
            this._exceptionHandler = callback;
        }

        private onMessage(message: message) {
            if (this._messageHandler != null &&
                message.sender != this._windowId &&
                message.recipients.some(r => r === this._windowId))
            {
                this._messageHandler(message.data);
                this.log(JSON.stringify(message));
            }
        }

        private startSiblingHandshake() {
            tbob.serviceBus.listenFor(this._reportAsSiblingKey, (sibling: siblingWindow) => {
                //this.log();
                if (sibling.windowId != this._windowId) {
                    if (!this.siblingArrayContains(this._siblingWindows, sibling.windowId)) {
                        this._siblingWindows.push(sibling)
                        tbob.serviceBus.fireEvent(this._reportAsSiblingKey, new siblingWindow(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), false)
                        this.log(JSON.stringify(sibling));
                    }
                }
            });

            tbob.serviceBus.listenFor(this._removeFromSiblingsKey, (windowId: string) => {
                if (windowId != this._windowId) {
                    const index = this.siblingArrayIndexOf(this._siblingWindows, windowId);
                    if (index !== -1) { this._siblingWindows.splice(index, 1); }
                    this.log(windowId);
                }
            });

            tbob.serviceBus.listenFor(this._startElectionKey, () => {
                if (this._electionActive == false) {
                    this._electionActive = true;
                    const vote = this.getOldestSibling();
                    tbob.serviceBus.fireEvent(this._castVoteKey, vote, false)
                    setTimeout(() => {
                        this.inaugurateWinner();
                        this._electionActive = false
                        this._votes.length = 0;
                    }, this._electionTimeout)
                }
            });

            tbob.serviceBus.listenFor(this._castVoteKey, (vote: string) => {
                this._votes.push(vote)
                this.log(JSON.stringify(vote));
            });

            $(window).on("beforeunload", () => {
                clearTimeout(this._siblingHeartbeat);
                tbob.serviceBus.fireEvent(this._removeFromSiblingsKey, this._windowId, false)
                if (this._isMaster === true) {
                    tbob.serviceBus.fireEvent(this._startElectionKey, null, true);
                }
            });

            clearTimeout(this._siblingHeartbeat);
            tbob.serviceBus.fireEvent(this._reportAsSiblingKey, new siblingWindow(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), false)
            this._siblingHeartbeat = setInterval(() => {
                tbob.serviceBus.fireEvent(this._reportAsSiblingKey, new siblingWindow(this._windowId, this._isMaster, this._openedTimestamp, this.timestamp()), false)
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

        private handleException(error: Error): void {
            this._exceptionHandler(error);
        }

        private siblingArrayContains(array: Array<siblingWindow>, value: string): boolean {
            //return this.siblingArrayIndexOf(array, value) >= 0;
            return this._siblingWindows.some(sw => sw.windowId == value);
        }

        private siblingArrayIndexOf(array: Array<siblingWindow>, value: string): number {
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

        private getMasterSibling(): siblingWindow {
            let result: siblingWindow = null;
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
            const sortedList = this._siblingWindows.sort((a, b) => {
                return a.openedTimestamp - b.openedTimestamp;
            });
            return sortedList.length == 0 ? this._windowId : (this._openedTimestamp < sortedList[0].openedTimestamp ? this._windowId : sortedList[0].windowId);
        }

        private inaugurateWinner(): void {
            const winningVote = this.majorityVote(this._votes);
            if (winningVote == null) {
                this.demandRevote();
            }
            else if (winningVote === this._windowId) {
                this.becomeMaster();
            }
            else {
                //const masterMatch = this._siblingWindows.filter(sw => sw.windowId === winningVote);
                //if (masterMatch.length > 0) {
                //    masterMatch[0].isMaster = true;
                //}
                //const slaveMatches = this._siblingWindows.filter(sw => sw.windowId !== winningVote);
                //if (slaveMatches.length > 0) {
                //    slaveMatches[0].isMaster = false;
                //}
                this._siblingWindows.filter(sw => sw.windowId === winningVote).forEach(sw => sw.isMaster = true);
                this._siblingWindows.filter(sw => sw.windowId !== winningVote).forEach(sw => sw.isMaster = false);

                this.becomeSlave();
            }
        }

        private demandRevote(): void {

        }

        private becomeMaster(): void {
            this._isMaster = true;
            this.messageSlaves("I AM THE MASTER!!!")
        }

        private becomeSlave(): void {
            this._isMaster = false;
            this.messageSlaves("we are slaves.")
        }

        private majorityVote(votes: Array<string>): string {
            if (votes.length == 0 || !votes.every(v => v == votes[0])) return null;
            const votesSortedByInstances = votes.sort((a, b) => votes.filter(v1 => v1 === b).length - votes.filter(v2 => v2 === a).length);
            return votesSortedByInstances[0];
        }

        private timestamp(): number {
            return +new Date();
        }

        private newGuid(): string {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0, v = c == "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        
        private startDebugging(): void {
            document.addEventListener("DOMContentLoaded", (event) => {
                const div = document.createElement("div");
                div.style.cssText = "position:absolute; bottom: 10px; right: 10px; width: 95%; height: 150px; padding:5px; background-color:white; border: 1px solid black; opacity: 0.5; z-index:100; overflow-x: hidden;overflow-y: auto;";
                this._debugDiv = div;
                document.getElementsByTagName('body')[0].appendChild(this._debugDiv );
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
                let debugText: string = JSON.stringify({ me: new siblingWindow(this._windowId, this._isMaster, this._openedTimestamp, null), siblings: this._siblingWindows });
                if (message != null) {
                    debugText = message;
                }
                console.log(`covfefe: ${debugText}`)

                if (this._debugDiv != null) {
                    this._debugDiv.innerHTML = `<pre><code class="language-json">${debugText}</code></pre>`;
                }
            }
        }
    }

    export class message {
        constructor(sender: string, recipients: Array<string>, data: any) {
            this.sender = sender;
            this.recipients = recipients;
            this.data = data;
            this.timestamp = +new Date();
        }

        public sender: string;
        public recipients: Array<string>;
        public data: any;
        public timestamp: number;
    }

    class siblingWindow {
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