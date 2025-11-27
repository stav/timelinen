/**
 * Timelion - Sample Data
 * 
 * Data structure:
 * - tracks: Array of track objects, each containing:
 *   - name: Track label shown on the left
 *   - events: Array of event objects with:
 *     - dates: Array with 1 element (point event) or 2 elements (range event)
 *     - label: Text label for the event
 * 
 * - visibleWindow: Object defining the visible date range
 *   - startDate: Start of visible range (YYYY-MM-DD)
 *   - endDate: End of visible range (YYYY-MM-DD)
 */

const tracks = [
  {
    name: "Nikola Tesla",
    events: [
      {
        dates: ["1856-07-10", "1943-01-07"],
        label: "Life (1856-1943)",
      },
      {
        dates: ["1884-06-06"],
        label: "Arrives in USA",
      },
      {
        dates: ["1887-04-01", "1888-05-01"],
        label: "AC Motor Development",
      },
      {
        dates: ["1891-07-30"],
        label: "US Citizenship",
      },
      {
        dates: ["1893-01-01", "1893-10-30"],
        label: "World's Columbian Expo",
      },
      {
        dates: ["1899-05-01", "1900-01-01"],
        label: "Colorado Springs Lab",
      },
      {
        dates: ["1901-01-01", "1905-01-01"],
        label: "Wardenclyffe Tower",
      },
    ],
  },
  {
    name: "Thomas Edison",
    events: [
      {
        dates: ["1847-02-11", "1931-10-18"],
        label: "Life (1847-1931)",
      },
      {
        dates: ["1877-11-21"],
        label: "Phonograph Invention",
      },
      {
        dates: ["1879-10-21"],
        label: "Practical Light Bulb",
      },
      {
        dates: ["1882-09-04"],
        label: "Pearl Street Station Opens",
      },
      {
        dates: ["1887-01-01", "1887-12-01"],
        label: "West Orange Lab Built",
      },
      {
        dates: ["1888-01-01", "1893-01-01"],
        label: "War of Currents",
      },
      {
        dates: ["1891-08-24"],
        label: "Kinetoscope Patent",
      },
    ],
  },
  {
    name: "Marie Curie",
    events: [
      {
        dates: ["1867-11-07", "1934-07-04"],
        label: "Life (1867-1934)",
      },
      {
        dates: ["1891-11-03"],
        label: "Moves to Paris",
      },
      {
        dates: ["1895-07-26"],
        label: "Marries Pierre",
      },
      {
        dates: ["1898-07-01"],
        label: "Discovers Polonium",
      },
      {
        dates: ["1898-12-26"],
        label: "Discovers Radium",
      },
      {
        dates: ["1903-12-10"],
        label: "Nobel Prize Physics",
      },
      {
        dates: ["1911-12-10"],
        label: "Nobel Prize Chemistry",
      },
      {
        dates: ["1914-01-01", "1918-11-11"],
        label: "WWI Mobile X-Ray Units",
      },
    ],
  },
  {
    name: "Albert Einstein",
    events: [
      {
        dates: ["1879-03-14", "1955-04-18"],
        label: "Life (1879-1955)",
      },
      {
        dates: ["1905-01-01", "1905-12-31"],
        label: "Annus Mirabilis Papers",
      },
      {
        dates: ["1915-11-25"],
        label: "General Relativity",
      },
      {
        dates: ["1921-12-10"],
        label: "Nobel Prize",
      },
      {
        dates: ["1933-10-17"],
        label: "Emigrates to USA",
      },
      {
        dates: ["1939-08-02"],
        label: "Einstein-Szilárd Letter",
      },
      {
        dates: ["1940-10-01"],
        label: "US Citizenship",
      },
    ],
  },
  {
    name: "Historical Events",
    events: [
      {
        dates: ["1861-04-12", "1865-05-09"],
        label: "American Civil War",
      },
      {
        dates: ["1876-03-10"],
        label: "First Telephone Call",
      },
      {
        dates: ["1903-12-17"],
        label: "Wright Brothers Flight",
      },
      {
        dates: ["1914-07-28", "1918-11-11"],
        label: "World War I",
      },
      {
        dates: ["1929-10-29"],
        label: "Black Tuesday",
      },
      {
        dates: ["1939-09-01", "1945-09-02"],
        label: "World War II",
      },
      {
        dates: ["1945-07-16"],
        label: "Trinity Test",
      },
    ],
  },
];

const visibleWindow = {
  startDate: "1840-01-01",
  endDate: "1960-01-01",
};

