/**
 * My Family Tree + Timeline
 * 
 * Data model for combined genealogy and timeline visualization.
 * Supports multiple lineages (maternal + paternal) converging on a focal person.
 */

window.familyTree = {
  // The focal person - generation numbers are relative to them (0)
  focalPerson: "tata",

  // All people in the tree
  people: {
    // === PATERNAL GREAT-GRANDPARENTS (Gen -3) ===
    "august": {
      name: "August",
      birth: "1837-05-01",
      death: "1917-12-31",
    },
    "johanna": {
      name: "Johanna",
      birth: "1843-03-01",
      death: "1926-12-31",
    },

    // === PATERNAL GRANDPARENTS (Gen -2) ===
    "peter": {
      name: "Peter James Almeroth",
      birth: "1872-03-10",
      death: "1947-05-31",
      parentIds: ["august", "johanna"],
    },
    "elizabeth": {
      name: "Elizabeth Frances Dwyer",
      birth: "1883-11-12",
      death: "1941-01-27",
      // Her parents not in tree (could add maternal great-grandparents here)
    },

    // === PARENTS (Gen -1) ===
    "pete": {
      name: "Pete",
      birth: "1940-02-21",
      death: "2020-12-31",
      parentIds: ["peter", "elizabeth"],
    },
    "suzie": {
      name: "Suzie",
      birth: "1945-11-15",
      death: "2015-12-31",
      // Her parents not in tree
    },

    // === FOCAL GENERATION (Gen 0) ===
    "maryann": {
      name: "Mary Ann",
      birth: "1963-03-15",
      parentIds: ["suzie"], // Different father, not in tree
    },
    "tata": {
      name: "Steven",
      birth: "1965-03-01",
      parentIds: ["pete", "suzie"],
      events: [
        { dates: ["1965-03-26"], label: "Born" },
        { dates: ["1980-01-01", "1984-06-01"], label: "Holy Name" },
        { dates: ["1984-09-01", "1988-05-01"], label: "UD" },
        { dates: ["2011-01-01", "2019-12-31"], label: "Shub" },
      ],
    },
    "david": {
      name: "David",
      birth: "1967-12-29",
      parentIds: ["pete", "suzie"],
    },

    // === SPOUSE (married into family) ===
    "mama": {
      name: "Mama",
      birth: "1979-05-15",
      // Her parents not in tree (could add maternal lineage)
    },

    // === CHILDREN (Gen +1) ===
    "cullen": {
      name: "Cullen",
      birth: "1994-11-25",
      parentIds: ["david"],
    },
    "daniel": {
      name: "Daniel",
      birth: "2019-06-17",
      parentIds: ["tata", "mama"],
      events: [
        { dates: ["2018-09-17"], label: "Conceived" },
      ],
    },

    // === PETS (optional - can include in timeline) ===
    "carbon": {
      name: "Carbon",
      birth: "2012-07-04",
      isPet: true,
      parentIds: ["tata", "mama"], // "adopted by"
      events: [
        { dates: ["2014-01-01", "2015-12-31"], label: "Rehab" },
      ],
    },
  },

  // Unions (marriages/partnerships) - defines family units
  unions: [
    {
      id: "august-johanna",
      partners: ["august", "johanna"],
      children: ["peter"],
    },
    {
      id: "peter-elizabeth",
      partners: ["peter", "elizabeth"],
      children: ["pete"],
    },
    {
      id: "suzie-unknown",
      partners: ["suzie"], // Father not in tree
      children: ["maryann"],
    },
    {
      id: "pete-suzie",
      partners: ["pete", "suzie"],
      children: ["tata", "david"],
    },
    {
      id: "tata-mama",
      partners: ["tata", "mama"],
      date: "2018-01-18", // Wedding date
      meetDate: "2005-10-01",
      children: ["daniel", "carbon"],
    },
    {
      id: "david-unknown",
      partners: ["david"],
      children: ["cullen"],
    },
  ],
};

window.visibleWindow = {
  startDate: "1830-01-01",
  endDate: "2026-01-01",
};

