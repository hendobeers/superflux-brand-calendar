// Superflux release calendar data. Dates are ISO (YYYY-MM-DD).
// kind: point (a release/event on one day) or span (on tap for a date range).
window.SFX_CALENDAR = {
  months: [
    { id: "2026-09", label: "September 2026" },
    { id: "2026-10", label: "October 2026" },
    { id: "2026-11", label: "November 2026" }
  ],
  categories: [
    { id: "core", label: "Core release" },
    { id: "exp", label: "Experimental" },
    { id: "fruit", label: "Heavy Fruit" },
    { id: "creamery", label: "The Creamery" },
    { id: "collab", label: "Collab" },
    { id: "release", label: "New release" },
    { id: "lto", label: "Wholesale $1 LTO" },
    { id: "event", label: "Event" },
    { id: "burger", label: "Food" }
  ],
  items: [
    // Spans — on tap
    { name: "Key Lime Pie Heavy Fruit", cat: "fruit", start: "2026-08-30", end: "2026-09-19" },
    { name: "Mixed Berry Waffle Whip Heavy Fruit", cat: "fruit", start: "2026-08-30", end: "2026-09-05" },
    { name: "$1 Easy Tiger LTO", cat: "lto", start: "2026-08-30", end: "2026-09-19" },
    { name: "$1 Colour & Shape LTO", cat: "lto", start: "2026-09-20", end: "2026-10-17" },
    { name: "$1 Happyness LTO", cat: "lto", start: "2026-10-18", end: "2026-11-21" },
    { name: "$1 Premium Rice Lager LTO", cat: "lto", start: "2026-10-18", end: "2026-11-21" },
    // September
    { name: "The Creamery Banana Cream Pie", cat: "creamery", date: "2026-09-03" },
    { name: "Exp. #85 West Coast", cat: "exp", date: "2026-09-09" },
    { name: "Exp. DIPA #1", cat: "exp", date: "2026-09-11" },
    { name: "Evergreen", cat: "core", date: "2026-09-15" },
    { name: "Smoke 'Em If You Got 'Em (Willibald)", cat: "collab", date: "2026-09-15" },
    { name: "Hayame Festbier (Godspeed)", cat: "collab", date: "2026-09-18" },
    { name: "Drip Tiramisu Coffee Stout", cat: "release", date: "2026-09-22" },
    { name: "Toroa", cat: "core", date: "2026-09-30" },
    // October
    { name: "The Creamery Pumpkin Pie", cat: "creamery", date: "2026-10-02" },
    { name: "Oktoberfest", cat: "event", date: "2026-10-03" },
    { name: "Exp. DIPA #2", cat: "exp", date: "2026-10-08" },
    { name: "Dreamscape", cat: "core", date: "2026-10-13" },
    { name: "Exp. #86 NZ Fresh Hop", cat: "exp", date: "2026-10-15" },
    { name: "Brewchacho' Negra", cat: "release", date: "2026-10-21" }
  ],
  // Recurring: Burger Day every Saturday and Sunday
  recurring: [
    { name: "Burger Day", cat: "burger", weekdays: [0, 6] }
  ]
};
