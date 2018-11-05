/**
 * @licstart The following is the entire license notice for the
 * Javascript code in this page
 *
 * Copyright 2018 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @licend The above is the entire license notice for the
 * Javascript code in this page
 */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PDFFindController = exports.FindState = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _pdf = require('../pdf');

var _pdf_find_utils = require('./pdf_find_utils');

var _dom_events = require('./dom_events');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var FindState = {
  FOUND: 0,
  NOT_FOUND: 1,
  WRAPPED: 2,
  PENDING: 3
};
var FIND_TIMEOUT = 250;
var CHARACTERS_TO_NORMALIZE = {
  '\u2018': '\'',
  '\u2019': '\'',
  '\u201A': '\'',
  '\u201B': '\'',
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"',
  '\xBC': '1/4',
  '\xBD': '1/2',
  '\xBE': '3/4'
};

var PDFFindController = function () {
  function PDFFindController(_ref) {
    var pdfViewer = _ref.pdfViewer,
        _ref$eventBus = _ref.eventBus,
        eventBus = _ref$eventBus === undefined ? (0, _dom_events.getGlobalEventBus)() : _ref$eventBus;

    _classCallCheck(this, PDFFindController);

    this._pdfViewer = pdfViewer;
    this._eventBus = eventBus;
    this.onUpdateResultsCount = null;
    this.onUpdateState = null;
    this.reset();
    var replace = Object.keys(CHARACTERS_TO_NORMALIZE).join('');
    this._normalizationRegex = new RegExp('[' + replace + ']', 'g');
  }

  _createClass(PDFFindController, [{
    key: 'reset',
    value: function reset() {
      var _this = this;

      this.active = false;
      this._pageMatches = [];
      this._pageMatchesLength = null;
      this._state = null;
      this._selected = {
        pageIdx: -1,
        matchIdx: -1
      };
      this._offset = {
        pageIdx: null,
        matchIdx: null
      };
      this._extractTextPromises = [];
      this._pageContents = [];
      this._matchesCountTotal = 0;
      this._pagesToSearch = null;
      this._pendingFindMatches = Object.create(null);
      this._resumePageIdx = null;
      this._dirtyMatch = false;
      this._findTimeout = null;
      this._firstPagePromise = new Promise(function (resolve) {
        var eventBus = _this._eventBus;
        eventBus.on('pagesinit', function onPagesInit() {
          eventBus.off('pagesinit', onPagesInit);
          resolve();
        });
      });
    }
  }, {
    key: 'executeCommand',
    value: function executeCommand(cmd, state) {
      var _this2 = this;

      if (this._state === null || cmd !== 'findagain') {
        this._dirtyMatch = true;
      }
      this._state = state;
      this._updateUIState(FindState.PENDING);
      this._firstPagePromise.then(function () {
        _this2._extractText();
        clearTimeout(_this2._findTimeout);
        if (cmd === 'find') {
          _this2._findTimeout = setTimeout(_this2._nextMatch.bind(_this2), FIND_TIMEOUT);
        } else {
          _this2._nextMatch();
        }
      });
    }
  }, {
    key: '_normalize',
    value: function _normalize(text) {
      return text.replace(this._normalizationRegex, function (ch) {
        return CHARACTERS_TO_NORMALIZE[ch];
      });
    }
  }, {
    key: '_prepareMatches',
    value: function _prepareMatches(matchesWithLength, matches, matchesLength) {
      function isSubTerm(matchesWithLength, currentIndex) {
        var currentElem = matchesWithLength[currentIndex];
        var nextElem = matchesWithLength[currentIndex + 1];
        if (currentIndex < matchesWithLength.length - 1 && currentElem.match === nextElem.match) {
          currentElem.skipped = true;
          return true;
        }
        for (var i = currentIndex - 1; i >= 0; i--) {
          var prevElem = matchesWithLength[i];
          if (prevElem.skipped) {
            continue;
          }
          if (prevElem.match + prevElem.matchLength < currentElem.match) {
            break;
          }
          if (prevElem.match + prevElem.matchLength >= currentElem.match + currentElem.matchLength) {
            currentElem.skipped = true;
            return true;
          }
        }
        return false;
      }
      matchesWithLength.sort(function (a, b) {
        return a.match === b.match ? a.matchLength - b.matchLength : a.match - b.match;
      });
      for (var i = 0, len = matchesWithLength.length; i < len; i++) {
        if (isSubTerm(matchesWithLength, i)) {
          continue;
        }
        matches.push(matchesWithLength[i].match);
        matchesLength.push(matchesWithLength[i].matchLength);
      }
    }
  }, {
    key: '_isEntireWord',
    value: function _isEntireWord(content, startIdx, length) {
      if (startIdx > 0) {
        var first = content.charCodeAt(startIdx);
        var limit = content.charCodeAt(startIdx - 1);
        if ((0, _pdf_find_utils.getCharacterType)(first) === (0, _pdf_find_utils.getCharacterType)(limit)) {
          return false;
        }
      }
      var endIdx = startIdx + length - 1;
      if (endIdx < content.length - 1) {
        var last = content.charCodeAt(endIdx);
        var _limit = content.charCodeAt(endIdx + 1);
        if ((0, _pdf_find_utils.getCharacterType)(last) === (0, _pdf_find_utils.getCharacterType)(_limit)) {
          return false;
        }
      }
      return true;
    }
  }, {
    key: '_calculatePhraseMatch',
    value: function _calculatePhraseMatch(query, pageIndex, pageContent, entireWord) {
      var matches = [];
      var queryLen = query.length;
      var matchIdx = -queryLen;
      while (true) {
        matchIdx = pageContent.indexOf(query, matchIdx + queryLen);
        if (matchIdx === -1) {
          break;
        }
        if (entireWord && !this._isEntireWord(pageContent, matchIdx, queryLen)) {
          continue;
        }
        matches.push(matchIdx);
      }
      this._pageMatches[pageIndex] = matches;
    }
  }, {
    key: '_calculateWordMatch',
    value: function _calculateWordMatch(query, pageIndex, pageContent, entireWord) {
      var matchesWithLength = [];
      var queryArray = query.match(/\S+/g);
      for (var i = 0, len = queryArray.length; i < len; i++) {
        var subquery = queryArray[i];
        var subqueryLen = subquery.length;
        var matchIdx = -subqueryLen;
        while (true) {
          matchIdx = pageContent.indexOf(subquery, matchIdx + subqueryLen);
          if (matchIdx === -1) {
            break;
          }
          if (entireWord && !this._isEntireWord(pageContent, matchIdx, subqueryLen)) {
            continue;
          }
          matchesWithLength.push({
            match: matchIdx,
            matchLength: subqueryLen,
            skipped: false
          });
        }
      }
      if (!this._pageMatchesLength) {
        this._pageMatchesLength = [];
      }
      this._pageMatchesLength[pageIndex] = [];
      this._pageMatches[pageIndex] = [];
      this._prepareMatches(matchesWithLength, this._pageMatches[pageIndex], this._pageMatchesLength[pageIndex]);
    }
  }, {
    key: '_calculateMatch',
    value: function _calculateMatch(pageIndex) {
      var pageContent = this._normalize(this._pageContents[pageIndex]);
      var query = this._normalize(this._state.query);
      var _state = this._state,
          caseSensitive = _state.caseSensitive,
          entireWord = _state.entireWord,
          phraseSearch = _state.phraseSearch;

      if (query.length === 0) {
        return;
      }
      if (!caseSensitive) {
        pageContent = pageContent.toLowerCase();
        query = query.toLowerCase();
      }
      if (phraseSearch) {
        this._calculatePhraseMatch(query, pageIndex, pageContent, entireWord);
      } else {
        this._calculateWordMatch(query, pageIndex, pageContent, entireWord);
      }
      this._updatePage(pageIndex);
      if (this._resumePageIdx === pageIndex) {
        this._resumePageIdx = null;
        this._nextPageMatch();
      }
      var pageMatchesCount = this._pageMatches[pageIndex].length;
      if (pageMatchesCount > 0) {
        this._matchesCountTotal += pageMatchesCount;
        this._updateUIResultsCount();
      }
    }
  }, {
    key: '_extractText',
    value: function _extractText() {
      var _this3 = this;

      if (this._extractTextPromises.length > 0) {
        return;
      }
      var promise = Promise.resolve();

      var _loop = function _loop(i, ii) {
        var extractTextCapability = (0, _pdf.createPromiseCapability)();
        _this3._extractTextPromises[i] = extractTextCapability.promise;
        promise = promise.then(function () {
          return _this3._pdfViewer.getPageTextContent(i).then(function (textContent) {
            var textItems = textContent.items;
            var strBuf = [];
            for (var j = 0, jj = textItems.length; j < jj; j++) {
              strBuf.push(textItems[j].str);
            }
            _this3._pageContents[i] = strBuf.join('');
            extractTextCapability.resolve(i);
          }, function (reason) {
            console.error('Unable to get text content for page ' + (i + 1), reason);
            _this3._pageContents[i] = '';
            extractTextCapability.resolve(i);
          });
        });
      };

      for (var i = 0, ii = this._pdfViewer.pagesCount; i < ii; i++) {
        _loop(i, ii);
      }
    }
  }, {
    key: '_updatePage',
    value: function _updatePage(index) {
      if (this._selected.pageIdx === index) {
        this._pdfViewer.currentPageNumber = index + 1;
      }
      var page = this._pdfViewer.getPageView(index);
      if (page.textLayer) {
        page.textLayer.updateMatches();
      }
    }
  }, {
    key: '_nextMatch',
    value: function _nextMatch() {
      var _this4 = this;

      var previous = this._state.findPrevious;
      var currentPageIndex = this._pdfViewer.currentPageNumber - 1;
      var numPages = this._pdfViewer.pagesCount;
      this.active = true;
      if (this._dirtyMatch) {
        this._dirtyMatch = false;
        this._selected.pageIdx = this._selected.matchIdx = -1;
        this._offset.pageIdx = currentPageIndex;
        this._offset.matchIdx = null;
        this._resumePageIdx = null;
        this._pageMatches.length = 0;
        this._pageMatchesLength = null;
        this._matchesCountTotal = 0;
        for (var i = 0; i < numPages; i++) {
          this._updatePage(i);
          if (!(i in this._pendingFindMatches)) {
            this._pendingFindMatches[i] = true;
            this._extractTextPromises[i].then(function (pageIdx) {
              delete _this4._pendingFindMatches[pageIdx];
              _this4._calculateMatch(pageIdx);
            });
          }
        }
      }
      if (this._state.query === '') {
        this._updateUIState(FindState.FOUND);
        return;
      }
      if (this._resumePageIdx) {
        return;
      }
      var offset = this._offset;
      this._pagesToSearch = numPages;
      if (offset.matchIdx !== null) {
        var numPageMatches = this._pageMatches[offset.pageIdx].length;
        if (!previous && offset.matchIdx + 1 < numPageMatches || previous && offset.matchIdx > 0) {
          offset.matchIdx = previous ? offset.matchIdx - 1 : offset.matchIdx + 1;
          this._updateMatch(true);
          return;
        }
        this._advanceOffsetPage(previous);
      }
      this._nextPageMatch();
    }
  }, {
    key: '_matchesReady',
    value: function _matchesReady(matches) {
      var offset = this._offset;
      var numMatches = matches.length;
      var previous = this._state.findPrevious;
      if (numMatches) {
        offset.matchIdx = previous ? numMatches - 1 : 0;
        this._updateMatch(true);
        return true;
      }
      this._advanceOffsetPage(previous);
      if (offset.wrapped) {
        offset.matchIdx = null;
        if (this._pagesToSearch < 0) {
          this._updateMatch(false);
          return true;
        }
      }
      return false;
    }
  }, {
    key: '_nextPageMatch',
    value: function _nextPageMatch() {
      if (this._resumePageIdx !== null) {
        console.error('There can only be one pending page.');
      }
      var matches = null;
      do {
        var pageIdx = this._offset.pageIdx;
        matches = this._pageMatches[pageIdx];
        if (!matches) {
          this._resumePageIdx = pageIdx;
          break;
        }
      } while (!this._matchesReady(matches));
    }
  }, {
    key: '_advanceOffsetPage',
    value: function _advanceOffsetPage(previous) {
      var offset = this._offset;
      var numPages = this._extractTextPromises.length;
      offset.pageIdx = previous ? offset.pageIdx - 1 : offset.pageIdx + 1;
      offset.matchIdx = null;
      this._pagesToSearch--;
      if (offset.pageIdx >= numPages || offset.pageIdx < 0) {
        offset.pageIdx = previous ? numPages - 1 : 0;
        offset.wrapped = true;
      }
    }
  }, {
    key: '_updateMatch',
    value: function _updateMatch() {
      var found = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

      var state = FindState.NOT_FOUND;
      var wrapped = this._offset.wrapped;
      this._offset.wrapped = false;
      if (found) {
        var previousPage = this._selected.pageIdx;
        this.selected.pageIdx = this._offset.pageIdx;
        this.selected.matchIdx = this._offset.matchIdx;
        state = wrapped ? FindState.WRAPPED : FindState.FOUND;
        if (previousPage !== -1 && previousPage !== this._selected.pageIdx) {
          this._updatePage(previousPage);
        }
      }
      this._updateUIState(state, this._state.findPrevious);
      if (this._selected.pageIdx !== -1) {
        this._updatePage(this._selected.pageIdx);
      }
    }
  }, {
    key: '_requestMatchesCount',
    value: function _requestMatchesCount() {
      var _selected = this._selected,
          pageIdx = _selected.pageIdx,
          matchIdx = _selected.matchIdx;

      var current = 0,
          total = this._matchesCountTotal;
      if (matchIdx !== -1) {
        for (var i = 0; i < pageIdx; i++) {
          current += this._pageMatches[i] && this._pageMatches[i].length || 0;
        }
        current += matchIdx + 1;
      }
      if (current < 1 || current > total) {
        current = total = 0;
      }
      return {
        current: current,
        total: total
      };
    }
  }, {
    key: '_updateUIResultsCount',
    value: function _updateUIResultsCount() {
      if (!this.onUpdateResultsCount) {
        return;
      }
      var matchesCount = this._requestMatchesCount();
      this.onUpdateResultsCount(matchesCount);
    }
  }, {
    key: '_updateUIState',
    value: function _updateUIState(state, previous) {
      if (!this.onUpdateState) {
        return;
      }
      var matchesCount = this._requestMatchesCount();
      this.onUpdateState(state, previous, matchesCount);
    }
  }, {
    key: 'pageMatches',
    get: function get() {
      return this._pageMatches;
    }
  }, {
    key: 'pageMatchesLength',
    get: function get() {
      return this._pageMatchesLength;
    }
  }, {
    key: 'selected',
    get: function get() {
      return this._selected;
    }
  }, {
    key: 'state',
    get: function get() {
      return this._state;
    }
  }]);

  return PDFFindController;
}();

exports.FindState = FindState;
exports.PDFFindController = PDFFindController;