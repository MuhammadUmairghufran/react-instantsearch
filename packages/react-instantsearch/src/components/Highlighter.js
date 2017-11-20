import PropTypes from 'prop-types';
import React from 'react';

import { classNamesNew } from './classNames.js';

const cx = classNamesNew('Highlight');

export default function Highlighter({
  hit,
  attributeName,
  highlight,
  highlightProperty,
  tagName,
}) {
  const parsedHighlightedValue = highlight({
    hit,
    attributeName,
    highlightProperty,
  });
  const reactHighlighted = parsedHighlightedValue.map((v, i) => {
    const key = `split-${i}-${v.value}`;
    if (!v.isHighlighted) {
      return (
        <span key={key} {...cx(['nonHighlighted'])}>
          {v.value}
        </span>
      );
    }
    const HighlightedTag = tagName ? tagName : 'em';
    return (
      <HighlightedTag key={key} {...cx(['highlighted'])}>
        {v.value}
      </HighlightedTag>
    );
  });
  return <span {...cx([''])}>{reactHighlighted}</span>;
}

Highlighter.propTypes = {
  hit: PropTypes.object.isRequired,
  attributeName: PropTypes.string.isRequired,
  highlight: PropTypes.func.isRequired,
  highlightProperty: PropTypes.string.isRequired,
  tagName: PropTypes.string,
};
