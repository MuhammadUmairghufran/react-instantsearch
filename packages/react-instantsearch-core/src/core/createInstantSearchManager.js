import { omit, find } from 'lodash';
import algoliasearchHelper, { SearchParameters } from 'algoliasearch-helper';
import createWidgetsManager from './createWidgetsManager';
import createStore from './createStore';
import { HIGHLIGHT_TAGS } from './highlight';

/**
 * Creates a new instance of the InstantSearchManager which controls the widgets and
 * trigger the search when the widgets are updated.
 * @param {string} indexName - the main index name
 * @param {object} initialState - initial widget state
 * @param {object} SearchParameters - optional additional parameters to send to the algolia API
 * @param {number} stalledSearchDelay - time (in ms) after the search is stalled
 * @return {InstantSearchManager} a new instance of InstantSearchManager
 */
export default function createInstantSearchManager({
  indexName,
  initialState = {},
  searchClient,
  resultsState,
  stalledSearchDelay,
}) {
  const baseSP = new SearchParameters({
    index: indexName,
    ...HIGHLIGHT_TAGS,
  });

  let stalledSearchTimer = null;

  const helper = algoliasearchHelper(searchClient, indexName, baseSP);
  helper.on('result', handleSearchSuccess);
  helper.on('error', handleSearchError);
  helper.on('search', handleNewSearch);

  // @TODO: Once we support react@16.3.0 we can replace
  // the array with a Map to store [deriveHelper, indexId].
  // It would be even easier to retrieve which content match
  // which indexId.
  let derivedHelpers = [];

  let initialSearchParameters = helper.state;

  const widgetsManager = createWidgetsManager(onWidgetsUpdate);

  const store = createStore({
    widgets: initialState,
    metadata: [],
    results: resultsState || null,
    error: null,
    searching: false,
    isSearchStalled: true,
    searchingForFacetValues: false,
  });

  let skip = false;

  function skipSearch() {
    skip = true;
  }

  function updateClient(client) {
    helper.setClient(client);
    search();
  }

  function clearCache() {
    helper.clearCache();
    search();
  }

  function getMetadata(state) {
    return widgetsManager
      .getWidgets()
      .filter(widget => Boolean(widget.getMetadata))
      .map(widget => widget.getMetadata(state));
  }

  function getSearchParameters() {
    const sharedParameters = widgetsManager
      .getWidgets()
      .filter(widget => Boolean(widget.getSearchParameters))
      .filter(
        widget =>
          !widget.context.multiIndexContext &&
          (widget.props.indexName === indexName || !widget.props.indexName)
      )
      .reduce(
        (res, widget) => widget.getSearchParameters(res),
        initialSearchParameters
      );

    const derivatedWidgets = widgetsManager
      .getWidgets()
      .filter(widget => Boolean(widget.getSearchParameters))
      .filter(
        widget =>
          (widget.context.multiIndexContext &&
            widget.context.multiIndexContext.targetedIndex !== indexName) ||
          (widget.props.indexName && widget.props.indexName !== indexName)
      )
      .reduce((indices, widget) => {
        const targetedIndex = widget.context.multiIndexContext
          ? widget.context.multiIndexContext.targetedIndex
          : widget.props.indexName;
        const index = find(indices, i => i.targetedIndex === targetedIndex);
        if (index) {
          index.widgets.push(widget);
        } else {
          indices.push({ targetedIndex, widgets: [widget] });
        }
        return indices;
      }, []);

    const mainIndexParameters = widgetsManager
      .getWidgets()
      .filter(widget => Boolean(widget.getSearchParameters))
      .filter(
        widget =>
          (widget.context.multiIndexContext &&
            widget.context.multiIndexContext.targetedIndex === indexName) ||
          (widget.props.indexName && widget.props.indexName === indexName)
      )
      .reduce(
        (res, widget) => widget.getSearchParameters(res),
        sharedParameters
      );

    return { sharedParameters, mainIndexParameters, derivatedWidgets };
  }

  function search() {
    if (!skip) {
      const {
        sharedParameters,
        mainIndexParameters,
        derivatedWidgets,
      } = getSearchParameters(helper.state);

      derivedHelpers.forEach(({ derivedHelper }) => derivedHelper.detach());
      derivedHelpers = [];

      helper.setState(sharedParameters);

      derivatedWidgets.forEach(derivatedSearchParameters => {
        const index = derivatedSearchParameters.targetedIndex;
        const derivedHelper = helper.derive(() =>
          derivatedSearchParameters.widgets.reduce(
            (res, widget) => widget.getSearchParameters(res),
            sharedParameters
          )
        );

        derivedHelper.on('result', handleSearchSuccess);
        derivedHelper.on('error', handleSearchError);

        derivedHelpers.push({
          indexId: index,
          derivedHelper,
        });
      });

      helper.setState(mainIndexParameters);

      helper.search();
    }
  }

  function handleSearchSuccess(content) {
    const state = store.getState();
    const isDerivedHelpersEmpty = !derivedHelpers.length;

    let results = state.results ? state.results : {};

    /* if switching from mono index to multi index and vice versa,
    results needs to reset to {}*/
    results = !isDerivedHelpersEmpty && results.getFacetByName ? {} : results;

    if (!isDerivedHelpersEmpty) {
      const { indexId = indexName } =
        derivedHelpers.find(
          ({ derivedHelper }) => derivedHelper.lastResults === content
        ) || {};

      results[indexId] = content;
    } else {
      results = content;
    }

    const currentState = store.getState();
    let nextIsSearchStalled = currentState.isSearchStalled;
    if (!helper.hasPendingRequests()) {
      clearTimeout(stalledSearchTimer);
      stalledSearchTimer = null;
      nextIsSearchStalled = false;
    }

    const nextState = omit(
      {
        ...currentState,
        results,
        isSearchStalled: nextIsSearchStalled,
        searching: false,
        error: null,
      },
      'resultsFacetValues'
    );
    store.setState(nextState);
  }

  function handleSearchError(error) {
    const currentState = store.getState();
    let nextIsSearchStalled = currentState.isSearchStalled;
    if (!helper.hasPendingRequests()) {
      clearTimeout(stalledSearchTimer);
      nextIsSearchStalled = false;
    }

    const nextState = omit(
      {
        ...currentState,
        isSearchStalled: nextIsSearchStalled,
        error,
        searching: false,
      },
      'resultsFacetValues'
    );
    store.setState(nextState);
  }

  function handleNewSearch() {
    if (!stalledSearchTimer) {
      stalledSearchTimer = setTimeout(() => {
        const nextState = omit(
          {
            ...store.getState(),
            isSearchStalled: true,
          },
          'resultsFacetValues'
        );
        store.setState(nextState);
      }, stalledSearchDelay);
    }
  }

  // Called whenever a widget has been rendered with new props.
  function onWidgetsUpdate() {
    const metadata = getMetadata(store.getState().widgets);

    store.setState({
      ...store.getState(),
      metadata,
      searching: true,
    });

    // Since the `getSearchParameters` method of widgets also depends on props,
    // the result search parameters might have changed.
    search();
  }

  function transitionState(nextSearchState) {
    const searchState = store.getState().widgets;
    return widgetsManager
      .getWidgets()
      .filter(widget => Boolean(widget.transitionState))
      .reduce(
        (res, widget) => widget.transitionState(searchState, res),
        nextSearchState
      );
  }

  function onExternalStateUpdate(nextSearchState) {
    const metadata = getMetadata(nextSearchState);

    store.setState({
      ...store.getState(),
      widgets: nextSearchState,
      metadata,
      searching: true,
    });

    search();
  }

  function onSearchForFacetValues({ facetName, query, maxFacetHits = 10 }) {
    // The values 1, 100 are the min / max values that the engine accepts.
    // see: https://www.algolia.com/doc/api-reference/api-parameters/maxFacetHits
    const maxFacetHitsWithinRange = Math.max(1, Math.min(maxFacetHits, 100));

    store.setState({
      ...store.getState(),
      searchingForFacetValues: true,
    });

    helper
      .searchForFacetValues(facetName, query, maxFacetHitsWithinRange)
      .then(
        content => {
          store.setState({
            ...store.getState(),
            error: null,
            searchingForFacetValues: false,
            resultsFacetValues: {
              ...store.getState().resultsFacetValues,
              [facetName]: content.facetHits,
              query,
            },
          });
        },
        error => {
          store.setState({
            ...store.getState(),
            searchingForFacetValues: false,
            error,
          });
        }
      )
      .catch(error => {
        // Since setState is synchronous, any error that occurs in the render of a
        // component will be swallowed by this promise.
        // This is a trick to make the error show up correctly in the console.
        // See http://stackoverflow.com/a/30741722/969302
        setTimeout(() => {
          throw error;
        });
      });
  }

  function updateIndex(newIndex) {
    initialSearchParameters = initialSearchParameters.setIndex(newIndex);
    search();
  }

  function getWidgetsIds() {
    return store
      .getState()
      .metadata.reduce(
        (res, meta) =>
          typeof meta.id !== 'undefined' ? res.concat(meta.id) : res,
        []
      );
  }

  return {
    store,
    widgetsManager,
    getWidgetsIds,
    onExternalStateUpdate,
    transitionState,
    onSearchForFacetValues,
    updateClient,
    updateIndex,
    clearCache,
    skipSearch,
  };
}
