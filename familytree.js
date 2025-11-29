/**
 * Family Tree + Timeline Visualization
 * Renders genealogy with time-based lifespan bars and relationship connectors
 */

(function () {
  'use strict';

  const CONFIG = {
    trackHeight: 50,           // Vertical space per track (person or couple)
    personHeight: 20,          // Height of lifespan bar
    labelAreaWidth: 0,         // No left label area (names on bars)
    axisHeight: 50,            // Height of time axis
    topPadding: 40,            // Top padding
    sidePadding: 40,           // Side padding
    minBarWidth: 40,           // Minimum width for lifespan bars
    connectorPadding: 15,      // Space between bar bottom and connector start
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let currentData = null;
  let computedLayout = null;

  // Zoom & pan state
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4;
  const ZOOM_SENSITIVITY = 0.002;
  const PAN_SENSITIVITY = 1.5;

  // Drag state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;

  // Original time scale (for reset)
  let originalVisibleWindow = null;

  // ============ UTILITY FUNCTIONS ============

  function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function dateToX(date, startDate, endDate, width) {
    const totalSpan = endDate.getTime() - startDate.getTime();
    const dateSpan = date.getTime() - startDate.getTime();
    return CONFIG.sidePadding + (dateSpan / totalSpan) * width;
  }

  function createSVGElement(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    return el;
  }

  // ============ GENERATION COMPUTATION ============

  /**
   * Compute generation numbers for all people relative to focal person.
   * Focal person = 0, parents = -1, grandparents = -2, children = +1, etc.
   */
  function computeGenerations(familyTree) {
    const { people, focalPerson, unions } = familyTree;
    const generations = {};
    
    // Start with focal person at generation 0
    generations[focalPerson] = 0;
    
    // Build child lookup from unions
    const childToParents = {};
    const parentToChildren = {};
    
    for (const union of unions) {
      for (const childId of union.children || []) {
        childToParents[childId] = union.partners;
      }
      for (const partnerId of union.partners) {
        if (!parentToChildren[partnerId]) parentToChildren[partnerId] = [];
        parentToChildren[partnerId].push(...(union.children || []));
      }
    }
    
    // Also use parentIds from people directly
    for (const [personId, person] of Object.entries(people)) {
      if (person.parentIds) {
        childToParents[personId] = person.parentIds;
        for (const parentId of person.parentIds) {
          if (!parentToChildren[parentId]) parentToChildren[parentId] = [];
          if (!parentToChildren[parentId].includes(personId)) {
            parentToChildren[parentId].push(personId);
          }
        }
      }
    }
    
    // BFS to assign generations
    const queue = [focalPerson];
    const visited = new Set([focalPerson]);
    
    while (queue.length > 0) {
      const current = queue.shift();
      const currentGen = generations[current];
      
      // Parents are one generation back (-1)
      const parents = childToParents[current] || [];
      for (const parentId of parents) {
        if (!visited.has(parentId) && people[parentId]) {
          generations[parentId] = currentGen - 1;
          visited.add(parentId);
          queue.push(parentId);
        }
      }
      
      // Children are one generation forward (+1)
      const children = parentToChildren[current] || [];
      for (const childId of children) {
        if (!visited.has(childId) && people[childId]) {
          generations[childId] = currentGen + 1;
          visited.add(childId);
          queue.push(childId);
        }
      }
      
      // Spouses share generation
      for (const union of unions) {
        if (union.partners.includes(current)) {
          for (const partnerId of union.partners) {
            if (!visited.has(partnerId) && people[partnerId]) {
              generations[partnerId] = currentGen;
              visited.add(partnerId);
              queue.push(partnerId);
            }
          }
        }
      }
    }
    
    return generations;
  }

  // ============ LAYOUT COMPUTATION ============

  /**
   * Build tracks: each person gets their own track, except married couples share a track.
   * Returns array of tracks, each track is { people: [ids], generation, unionId? }
   */
  function buildTracks(familyTree, generations) {
    const { people, unions } = familyTree;
    const tracks = [];
    const personToTrack = {}; // personId -> track index
    
    // First, create tracks for married couples
    for (const union of unions) {
      if (union.partners.length >= 2) {
        const [p1, p2] = union.partners;
        // Both partners must exist and be in same generation
        if (people[p1] && people[p2] && generations[p1] === generations[p2]) {
          const trackIdx = tracks.length;
          tracks.push({
            people: [p1, p2],
            generation: generations[p1],
            unionId: union.id,
            union: union,
          });
          personToTrack[p1] = trackIdx;
          personToTrack[p2] = trackIdx;
        }
      }
    }
    
    // Then, create individual tracks for everyone not in a couple track
    for (const [personId, person] of Object.entries(people)) {
      if (personToTrack[personId] === undefined) {
        const trackIdx = tracks.length;
        tracks.push({
          people: [personId],
          generation: generations[personId],
          unionId: null,
        });
        personToTrack[personId] = trackIdx;
      }
    }
    
    // Sort tracks by generation, then by earliest birth date in track
    tracks.sort((a, b) => {
      if (a.generation !== b.generation) return a.generation - b.generation;
      const aMinBirth = Math.min(...a.people.map(id => parseDate(people[id].birth).getTime()));
      const bMinBirth = Math.min(...b.people.map(id => parseDate(people[id].birth).getTime()));
      return aMinBirth - bMinBirth;
    });
    
    // Update personToTrack after sorting
    for (let i = 0; i < tracks.length; i++) {
      for (const personId of tracks[i].people) {
        personToTrack[personId] = i;
      }
    }
    
    return { tracks, personToTrack };
  }

  /**
   * Compute layout positions for all people and connectors.
   * Each person/couple gets their own track (horizontal row).
   */
  function computeLayout(familyTree, startDate, endDate, timelineWidth) {
    const { people, unions } = familyTree;
    const generations = computeGenerations(familyTree);
    
    // Build tracks
    const { tracks, personToTrack } = buildTracks(familyTree, generations);
    
    // Compute Y position for each track
    const trackY = {};
    for (let i = 0; i < tracks.length; i++) {
      trackY[i] = CONFIG.topPadding + i * CONFIG.trackHeight;
    }
    
    // Position people
    const personLayout = {};
    
    for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
      const track = tracks[trackIdx];
      const y = trackY[trackIdx];
      
      for (const personId of track.people) {
        const person = people[personId];
        const birthDate = parseDate(person.birth);
        const deathDate = person.death ? parseDate(person.death) : endDate;
        
        const x1 = dateToX(birthDate, startDate, endDate, timelineWidth);
        const x2 = dateToX(deathDate, startDate, endDate, timelineWidth);
        
        personLayout[personId] = {
          id: personId,
          person,
          generation: generations[personId],
          trackIdx,
          track,
          x: x1,
          y: y,
          width: Math.max(x2 - x1, CONFIG.minBarWidth),
          barX1: x1,
          barX2: x2,
          centerX: (x1 + x2) / 2,
          centerY: y + CONFIG.personHeight / 2,
        };
      }
    }
    
    // Compute union connectors
    const unionConnectors = [];
    for (const union of unions) {
      const partnerLayouts = union.partners
        .map(id => personLayout[id])
        .filter(Boolean);
      
      // Parent-child connectors
      const childLayouts = (union.children || [])
        .map(id => personLayout[id])
        .filter(Boolean)
        .filter(c => !people[c.id].isPet);
      
      if (partnerLayouts.length > 0 && childLayouts.length > 0) {
        const parentTrack = partnerLayouts[0];
        const parentY = parentTrack.y + CONFIG.personHeight;
        
        // Find parent center point (overlap of partners' lifespans)
        let parentCenterX;
        if (partnerLayouts.length >= 2) {
          const p1 = partnerLayouts[0];
          const p2 = partnerLayouts[1];
          const overlapStart = Math.max(p1.barX1, p2.barX1);
          const overlapEnd = Math.min(p1.barX2, p2.barX2);
          parentCenterX = (overlapStart + overlapEnd) / 2;
        } else {
          parentCenterX = partnerLayouts[0].centerX;
        }
        
        for (const child of childLayouts) {
          unionConnectors.push({
            type: 'parent-child',
            union,
            parentCenterX,
            parentY,
            parentTrackIdx: parentTrack.trackIdx,
            childCenterX: child.barX1,  // Use birth date position, not center
            childY: child.y,
            childTrackIdx: child.trackIdx,
            child,
          });
        }
      }
    }
    
    // Get generation boundaries for labels
    const genNumbers = [...new Set(Object.values(generations))].sort((a, b) => a - b);
    const minGen = Math.min(...genNumbers);
    const maxGen = Math.max(...genNumbers);
    
    // Map generation to first track in that generation
    const genFirstTrack = {};
    for (let i = 0; i < tracks.length; i++) {
      const gen = tracks[i].generation;
      if (genFirstTrack[gen] === undefined) {
        genFirstTrack[gen] = i;
      }
    }
    
    return {
      personLayout,
      unionConnectors,
      generations,
      tracks,
      trackY,
      personToTrack,
      genNumbers,
      genFirstTrack,
      minGen,
      maxGen,
      totalHeight: CONFIG.topPadding + tracks.length * CONFIG.trackHeight + CONFIG.axisHeight,
    };
  }

  // ============ RENDERING ============

  function renderPersonBar(svg, layout, startDate, endDate, timelineWidth, isFocal = false) {
    const { id, person, x, y, width, barX1, barX2 } = layout;
    const g = createSVGElement('g', { class: 'person' });
    
    // Determine bar style
    const isPet = person.isPet;
    const isDeceased = person.death && parseDate(person.death) < new Date();
    
    let fillColor, strokeColor;
    if (isFocal) {
      fillColor = '#4a7c59';
      strokeColor = '#7cb890';
    } else if (isPet) {
      fillColor = '#6b5b73';
      strokeColor = '#9d8ba7';
    } else if (isDeceased) {
      fillColor = '#3d5a80';
      strokeColor = '#5d8ab4';
    } else {
      fillColor = '#4a6670';
      strokeColor = '#6a9aaa';
    }
    
    // Lifespan bar
    const bar = createSVGElement('rect', {
      class: 'person-bar',
      x: barX1,
      y: y,
      width: Math.max(barX2 - barX1, CONFIG.minBarWidth),
      height: CONFIG.personHeight,
      rx: CONFIG.personHeight / 2,
      ry: CONFIG.personHeight / 2,
      fill: fillColor,
      stroke: strokeColor,
      'stroke-width': 1.5,
    });
    
    // Tooltip
    const birthYear = person.birth.split('-')[0];
    const deathYear = person.death ? person.death.split('-')[0] : 'present';
    bar.innerHTML = `<title>${person.name}\n${birthYear} – ${deathYear}</title>`;
    
    g.appendChild(bar);
    
    // Name label (inside bar if fits, otherwise above)
    const labelWidth = person.name.length * 7;
    const barWidth = barX2 - barX1;
    
    if (labelWidth < barWidth - 10) {
      // Label inside bar
      const label = createSVGElement('text', {
        class: 'person-label-inside',
        x: barX1 + 8,
        y: y + CONFIG.personHeight / 2 + 1,
        'dominant-baseline': 'middle',
        fill: '#ffffff',
        'font-size': '10px',
        'font-weight': '500',
        'pointer-events': 'none',
      });
      label.textContent = person.name;
      g.appendChild(label);
    } else {
      // Label above bar
      const label = createSVGElement('text', {
        class: 'person-label-outside',
        x: barX1,
        y: y - 4,
        fill: '#c9b896',
        'font-size': '10px',
        'font-weight': '400',
        'pointer-events': 'none',
      });
      label.textContent = person.name;
      g.appendChild(label);
    }
    
    svg.appendChild(g);
    return g;
  }

  function renderConnectors(svg, layout) {
    const g = createSVGElement('g', { class: 'connectors' });
    
    // Group connectors by union so we can draw shared horizontal lines
    const connectorsByUnion = {};
    for (const connector of layout.unionConnectors) {
      if (connector.type === 'parent-child') {
        const unionId = connector.union.id;
        if (!connectorsByUnion[unionId]) {
          connectorsByUnion[unionId] = [];
        }
        connectorsByUnion[unionId].push(connector);
      }
    }
    
    // Draw connectors for each union
    for (const [unionId, connectors] of Object.entries(connectorsByUnion)) {
      if (connectors.length === 0) continue;
      
      const { parentCenterX, parentY } = connectors[0];
      
      // Horizontal line Y is just below the parent track (in the gap between generations)
      const horizontalY = parentY + CONFIG.connectorPadding;
      
      // Find the leftmost and rightmost child X positions
      const childXs = connectors.map(c => c.childCenterX);
      const minChildX = Math.min(...childXs);
      const maxChildX = Math.max(...childXs);
      
      // Draw vertical line down from parent to horizontal line level
      const parentDrop = createSVGElement('line', {
        x1: parentCenterX,
        y1: parentY + 4,
        x2: parentCenterX,
        y2: horizontalY,
        stroke: 'rgba(200, 180, 150, 0.6)',
        'stroke-width': 1.5,
      });
      g.appendChild(parentDrop);
      
      // Draw horizontal line spanning all children
      if (connectors.length > 1 || parentCenterX !== minChildX) {
        const horizLine = createSVGElement('line', {
          x1: Math.min(parentCenterX, minChildX),
          y1: horizontalY,
          x2: Math.max(parentCenterX, maxChildX),
          y2: horizontalY,
          stroke: 'rgba(200, 180, 150, 0.6)',
          'stroke-width': 1.5,
        });
        g.appendChild(horizLine);
      }
      
      // Draw vertical drops to each child
      for (const connector of connectors) {
        const { childCenterX, childY } = connector;
        
        const childDrop = createSVGElement('line', {
          x1: childCenterX,
          y1: horizontalY,
          x2: childCenterX,
          y2: childY - 2,
          stroke: 'rgba(200, 180, 150, 0.6)',
          'stroke-width': 1.5,
        });
        g.appendChild(childDrop);
        
        // Small dot at child end
        const dot = createSVGElement('circle', {
          cx: childCenterX,
          cy: childY - 2,
          r: 3,
          fill: 'rgba(200, 180, 150, 0.8)',
        });
        g.appendChild(dot);
      }
    }
    
    svg.appendChild(g);
  }

  function renderGenerationLabels(svg, layout) {
    const g = createSVGElement('g', { class: 'generation-labels' });
    
    const genLabels = {
      '-4': 'GGG-Grandparents',
      '-3': 'GG-Grandparents',
      '-2': 'Grandparents',
      '-1': 'Parents',
      '0': 'You',
      '1': 'Children',
      '2': 'Grandchildren',
    };
    
    for (const gen of layout.genNumbers) {
      // Get Y position from first track in this generation
      const firstTrackIdx = layout.genFirstTrack[gen];
      if (firstTrackIdx === undefined) continue;
      
      const y = layout.trackY[firstTrackIdx] + CONFIG.personHeight / 2;
      const label = createSVGElement('text', {
        class: 'gen-label',
        x: 10,
        y: y,
        'dominant-baseline': 'middle',
        fill: 'rgba(255, 255, 255, 0.3)',
        'font-size': '11px',
        'font-style': 'italic',
      });
      label.textContent = genLabels[gen.toString()] || `Gen ${gen}`;
      g.appendChild(label);
    }
    
    svg.appendChild(g);
  }

  function renderAxis(svg, startDate, endDate, timelineWidth, yPosition) {
    const g = createSVGElement('g', {
      class: 'axis',
      transform: `translate(0, ${yPosition})`,
    });

    // Axis line
    const axisLine = createSVGElement('line', {
      class: 'axis-line',
      x1: CONFIG.sidePadding,
      y1: 0,
      x2: CONFIG.sidePadding + timelineWidth,
      y2: 0,
      stroke: 'rgba(255, 255, 255, 0.3)',
      'stroke-width': 2,
    });
    g.appendChild(axisLine);

    // Generate ticks
    const totalYears = endDate.getFullYear() - startDate.getFullYear();
    let interval;
    if (totalYears > 200) interval = 50;
    else if (totalYears > 100) interval = 25;
    else if (totalYears > 50) interval = 10;
    else if (totalYears > 20) interval = 5;
    else interval = 1;

    const startYear = Math.ceil(startDate.getFullYear() / interval) * interval;
    
    for (let year = startYear; year <= endDate.getFullYear(); year += interval) {
      const date = new Date(year, 0, 1);
      if (date >= startDate && date <= endDate) {
        const x = dateToX(date, startDate, endDate, timelineWidth);
        const isMajor = year % (interval * 2) === 0 || interval >= 25;
        const tickHeight = isMajor ? 12 : 8;

        const tick = createSVGElement('line', {
          x1: x, y1: 0, x2: x, y2: tickHeight,
          stroke: 'rgba(255, 255, 255, 0.25)',
          'stroke-width': 1,
        });
        g.appendChild(tick);

        const label = createSVGElement('text', {
          x: x,
          y: tickHeight + 14,
          'text-anchor': 'middle',
          fill: isMajor ? '#c9b896' : '#a0a0a0',
          'font-size': isMajor ? '12px' : '11px',
        });
        label.textContent = year.toString();
        g.appendChild(label);
      }
    }

    svg.appendChild(g);
  }

  // ============ MAIN RENDER ============

  function renderFamilyTree() {
    const container = document.getElementById('timeline-container');
    
    if (!document.getElementById('timeline')) {
      container.innerHTML = '<svg id="timeline"></svg>';
    }
    
    const svg = document.getElementById('timeline');
    svg.innerHTML = '';

    if (!currentData || !currentData.familyTree) {
      container.innerHTML = '<div class="error-message">No family tree data loaded.</div>';
      return;
    }

    const { familyTree, visibleWindow } = currentData;
    const startDate = parseDate(visibleWindow.startDate);
    const endDate = parseDate(visibleWindow.endDate);

    const containerWidth = container.clientWidth - 48;
    const timelineWidth = Math.max(containerWidth - CONFIG.sidePadding * 2, 800);

    // Compute layout
    const layout = computeLayout(familyTree, startDate, endDate, timelineWidth);
    computedLayout = layout;

    // Set SVG size
    const svgWidth = CONFIG.sidePadding * 2 + timelineWidth;
    const svgHeight = layout.totalHeight;
    
    svg.setAttribute('width', svgWidth);
    svg.setAttribute('height', svgHeight);
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    // Create content group for zoom/pan transforms
    const contentGroup = createSVGElement('g', { id: 'timeline-content' });
    svg.appendChild(contentGroup);

    // Render generation labels (behind everything)
    renderGenerationLabels(contentGroup, layout);

    // Render people bars
    for (const [personId, personLayout] of Object.entries(layout.personLayout)) {
      const isFocal = personId === familyTree.focalPerson;
      renderPersonBar(contentGroup, personLayout, startDate, endDate, timelineWidth, isFocal);
    }

    // Render connectors on top of bars so they're visible
    renderConnectors(contentGroup, layout);

    // Render time axis
    const axisY = layout.totalHeight - CONFIG.axisHeight + 10;
    renderAxis(contentGroup, startDate, endDate, timelineWidth, axisY);

    // Apply current zoom transform
    applyZoomTransform();
  }

  // ============ DATA LOADING ============

  function loadFamilyTreeFile(filename) {
    const container = document.getElementById('timeline-container');
    container.innerHTML = '<div class="loading-message">Loading family tree...</div>';

    const existingScript = document.getElementById('data-script');
    if (existingScript) existingScript.remove();

    // Clear globals
    if (window.familyTree) delete window.familyTree;
    if (window.visibleWindow) delete window.visibleWindow;

    const script = document.createElement('script');
    script.id = 'data-script';
    script.src = `data/${filename}.js`;

    script.onload = () => {
      if (typeof window.familyTree !== 'undefined' && typeof window.visibleWindow !== 'undefined') {
        currentData = {
          familyTree: window.familyTree,
          visibleWindow: window.visibleWindow,
        };
        
        // Store original visible window for reset
        originalVisibleWindow = {
          startDate: window.visibleWindow.startDate,
          endDate: window.visibleWindow.endDate,
        };
        
        const url = new URL(window.location);
        url.searchParams.set('data', filename);
        window.history.replaceState({}, '', url);
        
        renderFamilyTree();
      } else {
        container.innerHTML = '<div class="error-message">Data file missing familyTree or visibleWindow.</div>';
      }
    };

    script.onerror = () => {
      container.innerHTML = `<div class="error-message">Failed to load: data/${filename}.js</div>`;
    };

    document.body.appendChild(script);
  }

  // ============ INITIALIZATION ============

  const DATA_FILES = [
    { name: "My Family Tree", file: "mylife-tree", type: "familyTree" },
    { name: "Almeroth Family", file: "almeroth-tree", type: "familyTree" },
  ];

  function initDataSelector() {
    const select = document.getElementById('data-file');
    if (!select) return;

    // Clear existing options
    select.innerHTML = '';

    for (const dataFile of DATA_FILES) {
      const option = document.createElement('option');
      option.value = dataFile.file;
      option.textContent = dataFile.name;
      select.appendChild(option);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const initialFile = urlParams.get('data') || DATA_FILES[0]?.file;

    if (initialFile) {
      select.value = initialFile;
      loadFamilyTreeFile(initialFile);
    }

    select.addEventListener('change', (e) => {
      loadFamilyTreeFile(e.target.value);
    });
  }

  function init() {
    initDataSelector();
    initZoomControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(renderFamilyTree, 150);
  });

  // Zoom, scroll, and drag controls
  function initZoomControls() {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    // Wheel events: Alt+wheel = visual zoom, Ctrl+wheel = time scale zoom, Shift+wheel = horizontal pan, wheel = vertical pan
    container.addEventListener('wheel', (e) => {
      const svg = document.getElementById('timeline');
      if (!svg) return;

      if (e.ctrlKey) {
        // Ctrl+wheel: time scale zoom (adjusts start/end dates)
        e.preventDefault();
        
        if (!currentData || !currentData.visibleWindow) return;

        const startDate = parseDate(currentData.visibleWindow.startDate);
        const endDate = parseDate(currentData.visibleWindow.endDate);
        const totalSpan = endDate.getTime() - startDate.getTime();

        // Get mouse position relative to timeline area
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        
        // Calculate timeline width (same as in renderFamilyTree)
        const containerWidth = container.clientWidth - 48;
        const timelineWidth = Math.max(containerWidth - CONFIG.sidePadding * 2, 800);
        
        // Calculate where in the timeline the mouse is (0 to 1)
        const timelineX = mouseX - CONFIG.sidePadding;
        const mouseRatio = Math.max(0, Math.min(1, timelineX / timelineWidth));
        
        // Calculate the date under the mouse
        const mouseTime = startDate.getTime() + (mouseRatio * totalSpan);

        // Zoom factor: scroll up = zoom in (smaller range), scroll down = zoom out (larger range)
        const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87; // ~15% zoom per scroll step
        
        // Calculate new span
        const newSpan = totalSpan * zoomFactor;
        
        // Minimum span: 30 days, maximum span: 2000 years
        const minSpan = 30 * 24 * 60 * 60 * 1000;
        const maxSpan = 2000 * 365.25 * 24 * 60 * 60 * 1000;
        
        if (newSpan < minSpan || newSpan > maxSpan) return;

        // Calculate new start and end dates, keeping the mouse position fixed
        const newStartTime = mouseTime - (mouseRatio * newSpan);
        const newEndTime = mouseTime + ((1 - mouseRatio) * newSpan);
        
        const newStartDate = new Date(newStartTime);
        const newEndDate = new Date(newEndTime);

        // Format dates back to YYYY-MM-DD strings
        const formatDate = (d) => {
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };

        // Update the visible window
        currentData.visibleWindow.startDate = formatDate(newStartDate);
        currentData.visibleWindow.endDate = formatDate(newEndDate);

        // Re-render
        renderFamilyTree();
      } else if (e.altKey) {
        // Alt+wheel: visual zoom (transform-based)
        e.preventDefault();
        
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const delta = -e.deltaY * ZOOM_SENSITIVITY;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel * (1 + delta)));
        
        if (newZoom === zoomLevel) return;
        
        // Zoom toward cursor position
        const zoomFactor = newZoom / zoomLevel;
        panX = mouseX - (mouseX - panX) * zoomFactor;
        panY = mouseY - (mouseY - panY) * zoomFactor;
        
        zoomLevel = newZoom;
        applyZoomTransform();
      } else if (e.shiftKey) {
        // Shift+wheel: horizontal pan
        e.preventDefault();
        panX -= e.deltaY * PAN_SENSITIVITY;
        applyZoomTransform();
      } else {
        // Regular wheel: vertical pan
        e.preventDefault();
        panY -= e.deltaY * PAN_SENSITIVITY;
        applyZoomTransform();
      }
    }, { passive: false });

    // Drag to pan
    container.addEventListener('mousedown', (e) => {
      // Only start drag on primary button and not on interactive elements
      if (e.button !== 0) return;
      
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      container.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      
      panX = panStartX + dx;
      panY = panStartY + dy;
      applyZoomTransform();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        container.classList.remove('dragging');
      }
    });

    // Prevent context menu interfering with drag
    container.addEventListener('contextmenu', (e) => {
      if (isDragging) e.preventDefault();
    });

    // Escape key resets view
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        resetZoom();
      }
    });
  }

  function updateViewStats() {
    const zoomEl = document.getElementById('stat-zoom');
    const panEl = document.getElementById('stat-pan');
    const scaleEl = document.getElementById('stat-scale');
    
    if (zoomEl) zoomEl.textContent = zoomLevel.toFixed(2);
    if (panEl) panEl.textContent = `${Math.round(panX)}, ${Math.round(panY)}`;
    
    // Calculate and display time scale factor
    if (scaleEl && currentData && currentData.visibleWindow && originalVisibleWindow) {
      const currentStart = parseDate(currentData.visibleWindow.startDate);
      const currentEnd = parseDate(currentData.visibleWindow.endDate);
      const originalStart = parseDate(originalVisibleWindow.startDate);
      const originalEnd = parseDate(originalVisibleWindow.endDate);
      
      const currentSpan = currentEnd.getTime() - currentStart.getTime();
      const originalSpan = originalEnd.getTime() - originalStart.getTime();
      
      const scaleFactor = originalSpan / currentSpan;
      scaleEl.textContent = scaleFactor.toFixed(2) + 'x';
    }
  }

  function applyZoomTransform() {
    const content = document.getElementById('timeline-content');
    if (!content) return;
    
    content.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoomLevel})`);
    updateViewStats();
  }

  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    
    // Also reset time scale to original
    if (currentData && currentData.visibleWindow && originalVisibleWindow) {
      currentData.visibleWindow.startDate = originalVisibleWindow.startDate;
      currentData.visibleWindow.endDate = originalVisibleWindow.endDate;
      renderFamilyTree();
    } else {
      applyZoomTransform();
    }
  }

  // Expose for debugging
  window.renderFamilyTree = renderFamilyTree;
  window.loadFamilyTreeFile = loadFamilyTreeFile;
  window.resetZoom = resetZoom;
})();

