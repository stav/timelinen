/**
 * Family Tree + Timeline Visualization
 * Renders genealogy with time-based lifespan bars and relationship connectors
 */

(function () {
  'use strict';

  const CONFIG = {
    generationHeight: 80,      // Vertical space per generation
    personHeight: 20,          // Height of lifespan bar
    personGap: 12,             // Horizontal gap between people in same generation
    unionGap: 60,              // Horizontal gap between family units
    labelAreaWidth: 0,         // No left label area (names on bars)
    axisHeight: 50,            // Height of time axis
    connectorDropdown: 25,     // How far down connectors drop before going horizontal
    topPadding: 40,            // Top padding
    sidePadding: 40,           // Side padding
    minBarWidth: 40,           // Minimum width for lifespan bars
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let currentData = null;
  let computedLayout = null;

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
   * Compute layout positions for all people and connectors.
   * Groups people by generation, positions family units, computes connector paths.
   */
  function computeLayout(familyTree, startDate, endDate, timelineWidth) {
    const { people, unions } = familyTree;
    const generations = computeGenerations(familyTree);
    
    // Group people by generation
    const genGroups = {};
    for (const [personId, gen] of Object.entries(generations)) {
      if (!genGroups[gen]) genGroups[gen] = [];
      genGroups[gen].push(personId);
    }
    
    // Sort generations
    const genNumbers = Object.keys(genGroups).map(Number).sort((a, b) => a - b);
    const minGen = Math.min(...genNumbers);
    const maxGen = Math.max(...genNumbers);
    
    // Compute Y position for each generation
    const genY = {};
    for (let g = minGen; g <= maxGen; g++) {
      genY[g] = CONFIG.topPadding + (g - minGen) * CONFIG.generationHeight;
    }
    
    // Position people within each generation
    // Strategy: sort by birth date, group by unions
    const personLayout = {};
    
    for (const gen of genNumbers) {
      const peopleInGen = genGroups[gen] || [];
      
      // Sort by birth date
      peopleInGen.sort((a, b) => {
        const birthA = parseDate(people[a].birth);
        const birthB = parseDate(people[b].birth);
        return birthA.getTime() - birthB.getTime();
      });
      
      // Assign X positions based on birth/death dates (time-based positioning)
      for (const personId of peopleInGen) {
        const person = people[personId];
        const birthDate = parseDate(person.birth);
        const deathDate = person.death ? parseDate(person.death) : endDate;
        
        const x1 = dateToX(birthDate, startDate, endDate, timelineWidth);
        const x2 = dateToX(deathDate, startDate, endDate, timelineWidth);
        
        personLayout[personId] = {
          id: personId,
          person,
          generation: generations[personId],
          x: x1,
          y: genY[generations[personId]],
          width: Math.max(x2 - x1, CONFIG.minBarWidth),
          barX1: x1,
          barX2: x2,
          centerX: (x1 + x2) / 2,
          centerY: genY[generations[personId]] + CONFIG.personHeight / 2,
        };
      }
    }
    
    // Compute union connectors
    const unionConnectors = [];
    for (const union of unions) {
      const partnerLayouts = union.partners
        .map(id => personLayout[id])
        .filter(Boolean);
      
      if (partnerLayouts.length >= 2) {
        // Spouse connector: horizontal line between partners
        const p1 = partnerLayouts[0];
        const p2 = partnerLayouts[1];
        
        // Find overlap period
        const overlapStart = Math.max(p1.barX1, p2.barX1);
        const overlapEnd = Math.min(p1.barX2, p2.barX2);
        const connectorX = (overlapStart + overlapEnd) / 2;
        
        unionConnectors.push({
          type: 'spouse',
          union,
          partners: partnerLayouts,
          x: connectorX,
          y: p1.y + CONFIG.personHeight,
        });
      }
      
      // Parent-child connectors
      const childLayouts = (union.children || [])
        .map(id => personLayout[id])
        .filter(Boolean)
        .filter(c => !people[c.id].isPet); // Exclude pets from main connectors
      
      if (partnerLayouts.length > 0 && childLayouts.length > 0) {
        const parentY = partnerLayouts[0].y + CONFIG.personHeight;
        
        // Find parent center point (between spouses if two, or single parent center)
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
            childCenterX: child.centerX,
            childY: child.y,
            child,
          });
        }
      }
    }
    
    return {
      personLayout,
      unionConnectors,
      generations,
      genY,
      genNumbers,
      minGen,
      maxGen,
      totalHeight: CONFIG.topPadding + (maxGen - minGen + 1) * CONFIG.generationHeight + CONFIG.axisHeight,
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
    
    for (const connector of layout.unionConnectors) {
      if (connector.type === 'spouse') {
        // Horizontal line between spouses during overlap period
        const { partners, x, y } = connector;
        if (partners.length >= 2) {
          const p1 = partners[0];
          const p2 = partners[1];
          
          // Find the overlap region
          const overlapStart = Math.max(p1.barX1, p2.barX1);
          const overlapEnd = Math.min(p1.barX2, p2.barX2);
          
          if (overlapEnd > overlapStart) {
            // Small marriage connector at overlap midpoint
            const midX = (overlapStart + overlapEnd) / 2;
            const connectorY = p1.y + CONFIG.personHeight + 5;
            
            const line = createSVGElement('line', {
              class: 'spouse-connector',
              x1: midX - 8,
              y1: connectorY,
              x2: midX + 8,
              y2: connectorY,
              stroke: '#e07a5f',
              'stroke-width': 2,
            });
            g.appendChild(line);
            
            // Marriage symbol (small heart or dot)
            const symbol = createSVGElement('circle', {
              cx: midX,
              cy: connectorY,
              r: 3,
              fill: '#e07a5f',
            });
            g.appendChild(symbol);
          }
        }
      } else if (connector.type === 'parent-child') {
        const { parentCenterX, parentY, childCenterX, childY } = connector;
        
        // Vertical line down from parent
        const dropY = parentY + CONFIG.connectorDropdown;
        
        // Path: down from parents, horizontal to child's X, then down to child
        const path = createSVGElement('path', {
          class: 'parent-child-connector',
          d: `M ${parentCenterX} ${parentY + 8} 
              L ${parentCenterX} ${dropY} 
              L ${childCenterX} ${dropY} 
              L ${childCenterX} ${childY - 2}`,
          fill: 'none',
          stroke: 'rgba(255, 255, 255, 0.25)',
          'stroke-width': 1.5,
        });
        g.appendChild(path);
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
      const y = layout.genY[gen] + CONFIG.personHeight / 2;
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
    
    // Debug: log generations
    const debugGens = computeGenerations(familyTree);
    console.log('Generations:', JSON.stringify(debugGens));
    const startDate = parseDate(visibleWindow.startDate);
    const endDate = parseDate(visibleWindow.endDate);

    const containerWidth = container.clientWidth - 48;
    const timelineWidth = Math.max(containerWidth - CONFIG.sidePadding * 2, 800);

    // Compute layout
    const layout = computeLayout(familyTree, startDate, endDate, timelineWidth);
    computedLayout = layout;
    
    // Debug layout
    console.log('Timeline width:', timelineWidth);
    console.log('Layout persons:', Object.keys(layout.personLayout).length);
    for (const [id, p] of Object.entries(layout.personLayout)) {
      console.log(`  ${id}: gen=${p.generation}, x=${p.barX1.toFixed(0)}-${p.barX2.toFixed(0)}, y=${p.y}`);
    }

    // Set SVG size
    const svgWidth = CONFIG.sidePadding * 2 + timelineWidth;
    const svgHeight = layout.totalHeight;
    
    svg.setAttribute('width', svgWidth);
    svg.setAttribute('height', svgHeight);
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    // Render generation labels
    renderGenerationLabels(svg, layout);

    // Render connectors first (behind people)
    renderConnectors(svg, layout);

    // Render people
    for (const [personId, personLayout] of Object.entries(layout.personLayout)) {
      const isFocal = personId === familyTree.focalPerson;
      renderPersonBar(svg, personLayout, startDate, endDate, timelineWidth, isFocal);
    }

    // Render time axis
    const axisY = layout.totalHeight - CONFIG.axisHeight + 10;
    renderAxis(svg, startDate, endDate, timelineWidth, axisY);
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

  // Expose for debugging
  window.renderFamilyTree = renderFamilyTree;
  window.loadFamilyTreeFile = loadFamilyTreeFile;
})();

