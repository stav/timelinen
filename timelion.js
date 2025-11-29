/**
 * Timelion - Lightweight Timeline Visualization
 * Vanilla JavaScript + SVG, no dependencies
 */

(function () {
  'use strict';

  // Configuration
  const CONFIG = {
    trackHeight: 40,           // Height per track lane
    trackPadding: 0,           // Padding between tracks
    labelAreaWidth: 160,       // Left margin for track labels
    axisHeight: 50,            // Height of time axis at bottom
    eventHeight: 16,           // Height of range event pills
    pointRadius: 5,            // Radius of point events
    labelRowHeight: 14,        // Height per label row
    labelPadding: 3,           // Padding around label text
    labelMargin: 4,            // Margin between labels
    minEventWidth: 8,          // Minimum width for very short range events
    topPadding: 20,            // Top padding for labels above first track
  };

  // SVG namespace
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Current loaded data
  let currentData = null;

  /**
   * Available data files - add your data files here
   * Format: { name: "Display Name", file: "filename" }
   * Files should be in the data/ folder as filename.js
   */
  const DATA_FILES = [
    { name: "Scientists & Inventors", file: "scientists" },
    { name: "My Life", file: "mylife" },
    // Add more data files here:
    // { name: "World History", file: "history" },
    // { name: "Art Movements", file: "art" },
  ];

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
    return text.length * fontSize * 0.6;
  }

  /**
   * Check if a label fits inside a range event
   * Uses smaller font size for internal labels (9px vs 11px)
   * @param {string} fallbackLabel - Label to use if event.label is null (e.g., track name)
   */
  function labelFitsInRange(event, startDate, endDate, timelineWidth, fallbackLabel = null) {
    const labelText = event.label !== null ? event.label : fallbackLabel;
    if (labelText === null) return false;
    if (event.dates.length < 2) return false; // Point events can't have internal labels
    
    const eventStart = parseDate(event.dates[0]);
    const eventEnd = parseDate(event.dates[1]);
    const startX = dateToX(eventStart, startDate, endDate, timelineWidth);
    const endX = dateToX(eventEnd, startDate, endDate, timelineWidth);
    const pillWidth = Math.max(endX - startX, CONFIG.minEventWidth);
    // Use smaller font size (9px) for measuring internal labels
    const labelWidth = measureText(labelText, 9);
    
    return labelWidth <= pillWidth - 2; // Allow tighter fit
  }

  /**
   * Avoid label collisions by stacking into rows
   * Only includes events whose labels don't fit inside their range
   */
  function computeLabelRows(events, startDate, endDate, timelineWidth) {
    const rows = [];

    const sortedEvents = [...events].sort((a, b) => {
      const aStart = parseDate(a.dates[0]);
      const bStart = parseDate(b.dates[0]);
      return aStart.getTime() - bStart.getTime();
    });

    for (const event of sortedEvents) {
      // Skip events with null labels
      if (event.label === null) continue;
      
      // Skip range events whose labels fit inside
      if (labelFitsInRange(event, startDate, endDate, timelineWidth)) continue;

      const eventStart = parseDate(event.dates[0]);
      const eventStartX = dateToX(eventStart, startDate, endDate, timelineWidth);

      const labelWidth = measureText(event.label) + CONFIG.labelPadding * 2;
      const labelLeft = eventStartX;
      const labelRight = eventStartX + labelWidth;

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
            startX: eventStartX,
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
          startX: eventStartX,
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
   * Render the time axis
   */
  function renderAxis(svg, startDate, endDate, timelineWidth, yPosition) {
    const g = createSVGElement('g', {
      class: 'axis',
      transform: `translate(0, ${yPosition})`,
    });

    const axisLine = createSVGElement('line', {
      class: 'axis-line',
      x1: CONFIG.labelAreaWidth,
      y1: 0,
      x2: CONFIG.labelAreaWidth + timelineWidth,
      y2: 0,
    });
    g.appendChild(axisLine);

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
   * Show loading message
   */
  function showLoading() {
    const svg = document.getElementById('timeline');
    svg.innerHTML = '';
    const container = document.getElementById('timeline-container');
    container.innerHTML = '<div class="loading-message">Loading timeline data...</div>';
  }

  /**
   * Show error message
   */
  function showError(message) {
    const container = document.getElementById('timeline-container');
    container.innerHTML = `<div class="error-message">${message}</div>`;
  }

  /**
   * Main render function
   */
  function renderTimeline() {
    const container = document.getElementById('timeline-container');
    
    // Restore SVG if it was replaced with a message
    if (!document.getElementById('timeline')) {
      container.innerHTML = '<svg id="timeline"></svg>';
    }
    
    const svg = document.getElementById('timeline');
    svg.innerHTML = '';

    if (!currentData) {
      showError('No data loaded. Select a data file above.');
      return;
    }

    const { tracks, visibleWindow } = currentData;

    if (!tracks || !visibleWindow) {
      showError('Invalid data format. Expected tracks and visibleWindow.');
      return;
    }

    const startDate = parseDate(visibleWindow.startDate);
    const endDate = parseDate(visibleWindow.endDate);
    const numTracks = tracks.length;

    const containerWidth = container.clientWidth - 48;
    const timelineWidth = Math.max(containerWidth - CONFIG.labelAreaWidth, 800);

    // Compute label rows for each track
    const trackLabelRows = tracks.map((trackData) => {
      return computeLabelRows(trackData.events || trackData, startDate, endDate, timelineWidth).length;
    });

    // Check which tracks have any non-null labels
    const trackHasLabels = tracks.map((track) => {
      const events = track.events || track;
      return events.some(e => e.label !== null);
    });

    // Calculate total height
    let totalHeight = CONFIG.topPadding;
    const trackPositions = [];

    for (let i = 0; i < numTracks; i++) {
      // Only add extra label space if the track has labels
      const extraLabelSpace = trackHasLabels[i] ? Math.max(0, (trackLabelRows[i] - 1) * CONFIG.labelRowHeight) : 0;
      trackPositions.push(totalHeight + extraLabelSpace);
      // Use reduced height for tracks with no labels
      const effectiveTrackHeight = trackHasLabels[i] ? CONFIG.trackHeight : CONFIG.trackHeight * 0.4;
      // Don't double-count extraLabelSpace - it's already in trackPositions[i]
      totalHeight = trackPositions[i] + effectiveTrackHeight + CONFIG.trackPadding;
    }

    totalHeight += CONFIG.axisHeight;

    svg.setAttribute('width', CONFIG.labelAreaWidth + timelineWidth + 40);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', `0 0 ${CONFIG.labelAreaWidth + timelineWidth + 40} ${totalHeight}`);

    // Render tracks
    for (let i = 0; i < numTracks; i++) {
      const trackData = tracks[i].events || tracks[i];
      const trackName = tracks[i].name || null;
      const effectiveTrackHeight = trackHasLabels[i] ? CONFIG.trackHeight : CONFIG.trackHeight * 0.4;

      const g = createSVGElement('g', {
        class: 'track',
        transform: `translate(0, ${trackPositions[i]})`,
      });

      const labelY = effectiveTrackHeight / 2;
      
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

      const centerline = createSVGElement('line', {
        class: 'centerline',
        x1: CONFIG.labelAreaWidth,
        y1: labelY,
        x2: CONFIG.labelAreaWidth + timelineWidth,
        y2: labelY,
      });
      g.appendChild(centerline);

      const labelRows = computeLabelRows(trackData, startDate, endDate, timelineWidth);
      const maxLabelRows = labelRows.length;

      const eventLabelMap = new Map();
      for (const row of labelRows) {
        for (const labelInfo of row) {
          eventLabelMap.set(labelInfo.event, labelInfo);
        }
      }

      for (const event of trackData) {
        const eventStart = parseDate(event.dates[0]);
        const isRange = event.dates.length > 1;
        const eventEnd = isRange ? parseDate(event.dates[1]) : eventStart;

        const startX = dateToX(eventStart, startDate, endDate, timelineWidth);
        const endX = dateToX(eventEnd, startDate, endDate, timelineWidth);

        if (isRange) {
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
          const rangeTooltip = event.label !== null 
            ? `${event.label}\n${event.dates[0]} → ${event.dates[1]}`
            : `${event.dates[0]} → ${event.dates[1]}`;
          pill.innerHTML = `<title>${rangeTooltip}</title>`;
          g.appendChild(pill);
          
          // Render label inside pill if it fits (use trackName as fallback for null labels)
          const internalLabelText = event.label !== null ? event.label : trackName;
          if (labelFitsInRange(event, startDate, endDate, timelineWidth, trackName)) {
            const internalLabel = createSVGElement('text', {
              class: 'event-label-internal',
              x: startX + CONFIG.eventHeight / 2,  // Left-justify with padding for rounded edge
              y: labelY + 1,
              'text-anchor': 'start',
              'dominant-baseline': 'middle',
            });
            internalLabel.textContent = internalLabelText;
            g.appendChild(internalLabel);
          }
        } else {
          const circle = createSVGElement('circle', {
            class: 'event-point',
            cx: startX,
            cy: labelY,
            r: CONFIG.pointRadius,
          });
          const pointTooltip = event.label !== null
            ? `${event.label}\n${event.dates[0]}`
            : event.dates[0];
          circle.innerHTML = `<title>${pointTooltip}</title>`;
          g.appendChild(circle);
        }

        const labelInfo = eventLabelMap.get(event);
        if (labelInfo) {
          const { row: rowIndex, startX: labelStartX } = labelInfo;

          const labelYOffset = labelY - CONFIG.eventHeight / 2 - 8 - (maxLabelRows - 1 - rowIndex) * CONFIG.labelRowHeight;

          const connector = createSVGElement('line', {
            class: 'label-connector',
            x1: startX,
            y1: labelY - CONFIG.eventHeight / 2 - 2,
            x2: startX,
            y2: labelYOffset + 6,
          });
          g.appendChild(connector);

          const textWidth = measureText(event.label);
          const bgRect = createSVGElement('rect', {
            class: 'event-label-bg',
            x: labelStartX - CONFIG.labelPadding,
            y: labelYOffset - 10,
            width: textWidth + CONFIG.labelPadding * 2,
            height: 14,
          });
          g.appendChild(bgRect);

          const labelText = createSVGElement('text', {
            class: 'event-label',
            x: labelStartX,
            y: labelYOffset,
            'text-anchor': 'start',
          });
          labelText.textContent = event.label;
          g.appendChild(labelText);
        }
      }

      svg.appendChild(g);
    }

    const axisY = totalHeight - CONFIG.axisHeight + 10;
    renderAxis(svg, startDate, endDate, timelineWidth, axisY);
  }

  /**
   * Load a data file dynamically
   */
  function loadDataFile(filename) {
    showLoading();

    // Remove any previously loaded data script
    const existingScript = document.getElementById('data-script');
    if (existingScript) {
      existingScript.remove();
    }

    // Clear global variables
    if (window.tracks) delete window.tracks;
    if (window.visibleWindow) delete window.visibleWindow;

    const script = document.createElement('script');
    script.id = 'data-script';
    script.src = `data/${filename}.js`;
    
    script.onload = () => {
      // Check if data was loaded
      if (typeof window.tracks !== 'undefined' && typeof window.visibleWindow !== 'undefined') {
        currentData = {
          tracks: window.tracks,
          visibleWindow: window.visibleWindow,
        };
        
        // Update URL without reload
        const url = new URL(window.location);
        url.searchParams.set('data', filename);
        window.history.replaceState({}, '', url);
        
        renderTimeline();
      } else {
        showError(`Data file loaded but missing 'tracks' or 'visibleWindow' variables.`);
      }
    };

    script.onerror = () => {
      showError(`Failed to load data file: data/${filename}.js`);
    };

    document.body.appendChild(script);
  }

  /**
   * Initialize the data file selector
   */
  function initDataSelector() {
    const select = document.getElementById('data-file');
    if (!select) return;

    // Populate options
    for (const dataFile of DATA_FILES) {
      const option = document.createElement('option');
      option.value = dataFile.file;
      option.textContent = dataFile.name;
      select.appendChild(option);
    }

    // Get initial file from URL or use first file
    const urlParams = new URLSearchParams(window.location.search);
    const initialFile = urlParams.get('data') || DATA_FILES[0]?.file;

    if (initialFile) {
      select.value = initialFile;
      loadDataFile(initialFile);
    }

    // Handle selection change
    select.addEventListener('change', (e) => {
      loadDataFile(e.target.value);
    });
  }

  // Initialize on load
  function init() {
    initDataSelector();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(renderTimeline, 150);
  });

  // Expose for manual operations
  window.renderTimeline = renderTimeline;
  window.loadDataFile = loadDataFile;
})();

