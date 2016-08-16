import {PropTypes} from 'react';

import createConnector from '../createConnector';

function getId(props) {
  return props.id || props.attributeName;
}

function getValue(props, state) {
  const id = getId(props);
  if (typeof state[id] !== 'undefined') {
    let {min, max} = state[id];
    if (typeof min === 'string') {
      min = parseInt(min, 10);
    }
    if (typeof max === 'string') {
      max = parseInt(max, 10);
    }
    return {min, max};
  }
  if (typeof props.defaultValue !== 'undefined') {
    return props.defaultValue;
  }
  return {};
}

export default createConnector({
  displayName: 'AlgoliaRange',

  propTypes: {
    id: PropTypes.string,
    attributeName: PropTypes.string.isRequired,
    defaultValue: PropTypes.shape({
      min: PropTypes.number.isRequired,
      max: PropTypes.number.isRequired,
    }),
    min: PropTypes.number,
    max: PropTypes.number,
  },

  getProps(props, state, search) {
    const {attributeName} = props;
    let {min, max} = props;

    const hasMin = typeof min !== 'undefined';
    const hasMax = typeof max !== 'undefined';

    if (!hasMin || !hasMax) {
      if (!search.results) {
        return null;
      }

      const stats = search.results.getFacetStats(attributeName);
      if (!stats) {
        return null;
      }

      if (!hasMin) {
        min = stats.min;
      }
      if (!hasMax) {
        max = stats.max;
      }
    }

    const {
      min: valueMin = min,
      max: valueMax = max,
    } = getValue(props, state);

    return {
      min,
      max,
      value: {min: valueMin, max: valueMax},
    };
  },

  refine(props, state, nextValue) {
    return {
      ...state,
      [getId(props)]: nextValue,
    };
  },

  getSearchParameters(params, props, state) {
    const {attributeName} = props;
    const value = getValue(props, state);
    params = params.addDisjunctiveFacet(attributeName);

    const {min, max} = value;
    if (typeof min !== 'undefined') {
      params = params.addNumericRefinement(attributeName, '>=', min);
    }
    if (typeof max !== 'undefined') {
      params = params.addNumericRefinement(attributeName, '<=', max);
    }

    return params;
  },

  getMetadata(props, state) {
    const id = getId(props);
    const value = getValue(props, state);
    let filter;
    const hasMin = typeof value.min !== 'undefined';
    const hasMax = typeof value.max !== 'undefined';
    if (hasMin || hasMax) {
      let filterLabel = '';
      if (hasMin) {
        filterLabel += `${value.min} <= `;
      }
      filterLabel += props.attributeName;
      if (hasMax) {
        filterLabel += ` <= ${value.max}`;
      }
      filter = {
        key: `${id}.${filterLabel}`,
        label: filterLabel,
        clear: nextState => ({
          ...nextState,
          [id]: {},
        }),
      };
    }

    return {
      id,
      filters: filter ? [filter] : [],
    };
  },
});
