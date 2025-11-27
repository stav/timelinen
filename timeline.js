/**
 * Timelion - Lightweight Timeline Visualization
 * Vanilla JavaScript + SVG, no dependencies
 */

(function () {
  'use strict';

  // Configuration
  const CONFIG = {
    trackHeight: 80,           // Height per track lane
    trackPadding: 20,          // Padding between tracks
    labelAreaWidth: 160,       // Left margin for track labels
    axisHeight: 50,            // Height of time axis at bottom
    eventHeight: 20,           // Height of range event pills
    pointRadius: 6,            // Radius of point events
    labelRowHeight: 16,        // Height per label row
    labelPadding: 4,           // Padding around label text
    labelMargin: 6,            // Margin between labels
    minEventWidth: 8,          // Minimum width for very short range events
    topPadding: 40,            // Top padding for labels above first track
  };

  // SVG namespace
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Parse a date string (YYYY-MM-DD) into a Date object
   */
  function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  /**
   * Calculate the total span in milliseconds between two dates
   */
  function getTimeSpan(startDate, endDate) {
    return endDate.getTime() - startDate.getTime();
  }

  /**
   * Convert a date to an X position on the timeline
   */
  function dateToX(date, startDate, endDate, width) {
    const totalSpan = getTimeSpan(startDate, endDate);
    const dateSpan = date.getTime() - startDate.getTime();
    return CONFIG.labelAreaWidth + (dateSpan / totalSpan) * width;
  }

  /**
   * Create an SVG element with attributes
   */
  function createSVGElement(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    return el;
  }

  /**
   * Measure text width (approximate)
   */
  function measureText(text, fontSize = 11) {
    // Approximate character width ratio
    return text.length * fontSize * 0.6;
  }

  /**
   * Avoid label collisions by stacking into rows
   */
  function computeLabelRows(events, startDate, endDate, timelineWidth) {
    const rows = [];

    // Process events sorted by start position
    const sortedEvents = [...events].sort((a, b) => {
      const aStart = parseDate(a.dates[0]);
      const bStart = parseDate(b.dates[0]);
      return aStart.getTime() - bStart.getTime();
    });

    for (const event of sortedEvents) {
      const eventStart = parseDate(event.dates[0]);
      const eventEnd = event.dates.length > 1 ? parseDate(event.dates[1]) : eventStart;
      const eventCenterX = dateToX(
        new Date((eventStart.getTime() + eventEnd.getTime()) / 2),
        startDate,
        endDate,
        timelineWidth
      );

      const labelWidth = measureText(event.label) + CONFIG.labelPadding * 2;
      const labelLeft = eventCenterX - labelWidth / 2;
      const labelRight = eventCenterX + labelWidth / 2;

      // Find the first row where this label fits without collision
      let placed = false;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        let hasCollision = false;

        for (const existing of row) {
          if (!(labelRight + CONFIG.labelMargin < existing.left || 
                labelLeft - CONFIG.labelMargin > existing.right)) {
            hasCollision = true;
            break;
          }
        }

        if (!hasCollision) {
          row.push({
            event,
            left: labelLeft,
            right: labelRight,
            centerX: eventCenterX,
            row: rowIndex,
          });
          placed = true;
          break;
        }
      }

      if (!placed) {
        rows.push([{
          event,
          left: labelLeft,
          right: labelRight,
          centerX: eventCenterX,
          row: rows.length,
        }]);
      }
    }

    return rows;
  }

  /**
   * Generate time axis ticks based on the date range
   */
  function generateAxisTicks(startDate, endDate) {
    const ticks = [];
    const totalYears = endDate.getFullYear() - startDate.getFullYear();

    let interval;
    if (totalYears > 200) {
      interval = 50;
    } else if (totalYears > 100) {
      interval = 25;
    } else if (totalYears > 50) {
      interval = 10;
    } else if (totalYears > 20) {
      interval = 5;
    } else if (totalYears > 10) {
      interval = 2;
    } else {
      interval = 1;
    }

    const startYear = Math.ceil(startDate.getFullYear() / interval) * interval;
    const endYear = endDate.getFullYear();

    for (let year = startYear; year <= endYear; year += interval) {
      const date = new Date(year, 0, 1);
      if (date >= startDate && date <= endDate) {
        ticks.push({
          date,
          label: year.toString(),
          isMajor: year % (interval * 2) === 0 || interval >= 25,
        });
      }
    }

    return ticks;
  }

  /**
   * Render a single track
   */
  function renderTrack(svg, trackData, trackIndex, startDate, endDate, timelineWidth, trackName) {
    const g = createSVGElement('g', {
      class: 'track',
      transform: `translate(0, ${CONFIG.topPadding + trackIndex * (CONFIG.trackHeight + CONFIG.trackPadding)})`,
    });

    // Track label
    const labelY = CONFIG.trackHeight / 2;
    const trackLabel = createSVGElement('text', {
      class: 'track-label',
      x: 20,
      y: labelY,
      'dominant-baseline': 'middle',
    });
    trackLabel.textContent = trackName || `Track ${trackIndex + 1}`;
    g.appendChild(trackLabel);

    // Centerline
    const centerline = createSVGElement('line', {
      class: 'centerline',
      x1: CONFIG.labelAreaWidth,
      y1: labelY,
      x2: CONFIG.labelAreaWidth + timelineWidth,
      y2: labelY,
    });
    g.appendChild(centerline);

    // Compute label rows for collision avoidance
    const labelRows = computeLabelRows(trackData, startDate, endDate, timelineWidth);
    const maxLabelRows = labelRows.length;

    // Render events
    for (const event of trackData) {
      const eventStart = parseDate(event.dates[0]);
      const isRange = event.dates.length > 1;
      const eventEnd = isRange ? parseDate(event.dates[1]) : eventStart;

      const startX = dateToX(eventStart, startDate, endDate, timelineWidth);
      const endX = dateToX(eventEnd, startDate, endDate, timelineWidth);
      const centerX = (startX + endX) / 2;

      if (isRange) {
        // Range event - pill shape
        const width = Math.max(endX - startX, CONFIG.minEventWidth);
        const pill = createSVGElement('rect', {
          class: 'event-pill',
          x: startX,
          y: labelY - CONFIG.eventHeight / 2,
          width: width,
          height: CONFIG.eventHeight,
          rx: CONFIG.eventHeight / 2,
          ry: CONFIG.eventHeight / 2,
        });
        pill.innerHTML = `<title>${event.label}\n${event.dates[0]} → ${event.dates[1]}</title>`;
        g.appendChild(pill);
      } else {
        // Point event - circle
        const circle = createSVGElement('circle', {
          class: 'event-point',
          cx: startX,
          cy: labelY,
          r: CONFIG.pointRadius,
        });
        circle.innerHTML = `<title>${event.label}\n${event.dates[0]}</title>`;
        g.appendChild(circle);
      }
    }

    // Render labels (above events)
    for (const row of labelRows) {
      for (const labelInfo of row) {
        const { event, centerX, row: rowIndex } = labelInfo;
        const eventStart = parseDate(event.dates[0]);
        const isRange = event.dates.length > 1;
        const eventEnd = isRange ? parseDate(event.dates[1]) : eventStart;
        const eventCenterX = dateToX(
          new Date((eventStart.getTime() + eventEnd.getTime()) / 2),
          startDate,
          endDate,
          timelineWidth
        );

        const labelY_offset = labelY - CONFIG.eventHeight / 2 - 8 - (maxLabelRows - 1 - rowIndex) * CONFIG.labelRowHeight;

        // Connector line
        const connector = createSVGElement('line', {
          class: 'label-connector',
          x1: eventCenterX,
          y1: labelY - CONFIG.eventHeight / 2 - 2,
          x2: eventCenterX,
          y2: labelY_offset + 6,
        });
        g.appendChild(connector);

        // Label background
        const textWidth = measureText(event.label);
        const bgRect = createSVGElement('rect', {
          class: 'event-label-bg',
          x: eventCenterX - textWidth / 2 - CONFIG.labelPadding,
          y: labelY_offset - 10,
          width: textWidth + CONFIG.labelPadding * 2,
          height: 14,
        });
        g.appendChild(bgRect);

        // Label text
        const labelText = createSVGElement('text', {
          class: 'event-label',
          x: eventCenterX,
          y: labelY_offset,
          'text-anchor': 'middle',
        });
        labelText.textContent = event.label;
        g.appendChild(labelText);
      }
    }

    svg.appendChild(g);
    return maxLabelRows;
  }

  /**
   * Render the time axis
   */
  function renderAxis(svg, startDate, endDate, timelineWidth, yPosition) {
    const g = createSVGElement('g', {
      class: 'axis',
      transform: `translate(0, ${yPosition})`,
    });

    // Main axis line
    const axisLine = createSVGElement('line', {
      class: 'axis-line',
      x1: CONFIG.labelAreaWidth,
      y1: 0,
      x2: CONFIG.labelAreaWidth + timelineWidth,
      y2: 0,
    });
    g.appendChild(axisLine);

    // Ticks
    const ticks = generateAxisTicks(startDate, endDate);
    for (const tick of ticks) {
      const x = dateToX(tick.date, startDate, endDate, timelineWidth);
      const tickHeight = tick.isMajor ? 12 : 8;

      const tickLine = createSVGElement('line', {
        class: 'axis-tick',
        x1: x,
        y1: 0,
        x2: x,
        y2: tickHeight,
      });
      g.appendChild(tickLine);

      const tickLabel = createSVGElement('text', {
        class: `axis-label ${tick.isMajor ? 'axis-label-major' : ''}`,
        x: x,
        y: tickHeight + 14,
      });
      tickLabel.textContent = tick.label;
      g.appendChild(tickLabel);
    }

    svg.appendChild(g);
  }

  /**
   * Main render function
   */
  function renderTimeline() {
    const svg = document.getElementById('timeline');
    if (!svg) {
      console.error('Timeline SVG element not found');
      return;
    }

    // Clear existing content
    svg.innerHTML = '';

    // Get data from global scope
    if (typeof tracks === 'undefined' || typeof visibleWindow === 'undefined') {
      console.error('Timeline data not found. Make sure data.js is loaded.');
      return;
    }

    const startDate = parseDate(visibleWindow.startDate);
    const endDate = parseDate(visibleWindow.endDate);
    const numTracks = tracks.length;

    // Calculate dimensions
    const containerWidth = document.getElementById('timeline-container').clientWidth - 48;
    const timelineWidth = Math.max(containerWidth - CONFIG.labelAreaWidth, 800);

    // First pass: compute label rows for each track to determine heights
    const trackLabelRows = tracks.map((trackData, i) => {
      return computeLabelRows(trackData.events || trackData, startDate, endDate, timelineWidth).length;
    });

    // Calculate total height needed
    let totalHeight = CONFIG.topPadding;
    const trackPositions = [];

    for (let i = 0; i < numTracks; i++) {
      const extraLabelSpace = Math.max(0, (trackLabelRows[i] - 1) * CONFIG.labelRowHeight);
      trackPositions.push(totalHeight + extraLabelSpace);
      totalHeight += CONFIG.trackHeight + CONFIG.trackPadding + extraLabelSpace;
    }

    totalHeight += CONFIG.axisHeight;

    // Set SVG dimensions
    svg.setAttribute('width', CONFIG.labelAreaWidth + timelineWidth + 40);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', `0 0 ${CONFIG.labelAreaWidth + timelineWidth + 40} ${totalHeight}`);

    // Render tracks
    for (let i = 0; i < numTracks; i++) {
      const trackData = tracks[i].events || tracks[i];
      const trackName = tracks[i].name || null;

      const g = createSVGElement('g', {
        class: 'track',
        transform: `translate(0, ${trackPositions[i]})`,
      });

      // Track label
      const labelY = CONFIG.trackHeight / 2;
      if (trackName) {
        const trackLabel = createSVGElement('text', {
          class: 'track-label',
          x: 20,
          y: labelY,
          'dominant-baseline': 'middle',
        });
        trackLabel.textContent = trackName;
        g.appendChild(trackLabel);
      }

      // Centerline
      const centerline = createSVGElement('line', {
        class: 'centerline',
        x1: CONFIG.labelAreaWidth,
        y1: labelY,
        x2: CONFIG.labelAreaWidth + timelineWidth,
        y2: labelY,
      });
      g.appendChild(centerline);

      // Compute label rows for collision avoidance
      const labelRows = computeLabelRows(trackData, startDate, endDate, timelineWidth);
      const maxLabelRows = labelRows.length;

      // Create a flat map of event -> label info
      const eventLabelMap = new Map();
      for (const row of labelRows) {
        for (const labelInfo of row) {
          eventLabelMap.set(labelInfo.event, labelInfo);
        }
      }

      // Render events
      for (const event of trackData) {
        const eventStart = parseDate(event.dates[0]);
        const isRange = event.dates.length > 1;
        const eventEnd = isRange ? parseDate(event.dates[1]) : eventStart;

        const startX = dateToX(eventStart, startDate, endDate, timelineWidth);
        const endX = dateToX(eventEnd, startDate, endDate, timelineWidth);

        if (isRange) {
          // Range event - pill shape
          const width = Math.max(endX - startX, CONFIG.minEventWidth);
          const pill = createSVGElement('rect', {
            class: 'event-pill',
            x: startX,
            y: labelY - CONFIG.eventHeight / 2,
            width: width,
            height: CONFIG.eventHeight,
            rx: CONFIG.eventHeight / 2,
            ry: CONFIG.eventHeight / 2,
          });
          pill.innerHTML = `<title>${event.label}\n${event.dates[0]} → ${event.dates[1]}</title>`;
          g.appendChild(pill);
        } else {
          // Point event - circle
          const circle = createSVGElement('circle', {
            class: 'event-point',
            cx: startX,
            cy: labelY,
            r: CONFIG.pointRadius,
          });
          circle.innerHTML = `<title>${event.label}\n${event.dates[0]}</title>`;
          g.appendChild(circle);
        }

        // Render label
        const labelInfo = eventLabelMap.get(event);
        if (labelInfo) {
          const { centerX, row: rowIndex } = labelInfo;
          const eventCenterX = dateToX(
            new Date((eventStart.getTime() + eventEnd.getTime()) / 2),
            startDate,
            endDate,
            timelineWidth
          );

          const labelYOffset = labelY - CONFIG.eventHeight / 2 - 8 - (maxLabelRows - 1 - rowIndex) * CONFIG.labelRowHeight;

          // Connector line
          const connector = createSVGElement('line', {
            class: 'label-connector',
            x1: eventCenterX,
            y1: labelY - CONFIG.eventHeight / 2 - 2,
            x2: eventCenterX,
            y2: labelYOffset + 6,
          });
          g.appendChild(connector);

          // Label background
          const textWidth = measureText(event.label);
          const bgRect = createSVGElement('rect', {
            class: 'event-label-bg',
            x: eventCenterX - textWidth / 2 - CONFIG.labelPadding,
            y: labelYOffset - 10,
            width: textWidth + CONFIG.labelPadding * 2,
            height: 14,
          });
          g.appendChild(bgRect);

          // Label text
          const labelText = createSVGElement('text', {
            class: 'event-label',
            x: eventCenterX,
            y: labelYOffset,
            'text-anchor': 'middle',
          });
          labelText.textContent = event.label;
          g.appendChild(labelText);
        }
      }

      svg.appendChild(g);
    }

    // Render axis at the bottom
    const axisY = totalHeight - CONFIG.axisHeight + 10;
    renderAxis(svg, startDate, endDate, timelineWidth, axisY);
  }

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderTimeline);
  } else {
    renderTimeline();
  }

  // Handle window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(renderTimeline, 150);
  });

  // Expose for manual re-render
  window.renderTimeline = renderTimeline;
})();

