/**
 * Excel Validator - Master Data Index
 * Builds fast lookup structures ONCE from the existing global master data
 * (window.BD_LOCATIONS from js/bd-locations.js, FIXED_DESIGNATIONS/FIXED_ROLES
 * from js/storage.js) - does not duplicate that data, just indexes it so
 * hierarchy-aware matching over thousands of rows stays fast:
 *  - exact lookups are O(1) via normalized-string Maps
 *  - fuzzy fallback only ever runs against the small candidate list for the
 *    relevant hierarchy level (e.g. only districts of an already-matched
 *    division), never the full location table.
 */
(function () {
  function buildLocationIndex() {
    const locations = (typeof window !== 'undefined' && window.BD_LOCATIONS) || {};

    const divisions = [];                 // ['Dhaka', 'Chattogram', ...]
    const districtsByDivision = {};        // { Dhaka: ['Dhaka','Gazipur',...] }
    const upazilasByDivisionDistrict = {}; // { 'Dhaka|Gazipur': ['Gazipur Sadar', ...] }
    const thanasByPath = {};               // { 'Dhaka|Gazipur|Gazipur Sadar': ['Gazipur Sadar'] }

    // Deduplicated flat name lists, used as the fallback candidate pool when a parent
    // level couldn't be confidently matched (so scoping to it isn't possible yet).
    const allDistrictNamesSet = new Set();
    const allUpazilaNamesSet = new Set();
    const allThanaNamesSet = new Set();

    const divisionExact = new Map();       // normalized(division) -> division
    const districtExact = new Map();       // normalized(division|district) -> {division,district}
    const districtByNameOnly = new Map();  // normalized(district) -> [{division,district}, ...]
    const upazilaExact = new Map();        // normalized(division|district|upazila) -> {division,district,upazila}
    const upazilaByNameOnly = new Map();   // normalized(upazila) -> [{division,district,upazila}, ...]
    const thanaExact = new Map();          // normalized(division|district|upazila|thana) -> {..., thana}
    const thanaByNameOnly = new Map();     // normalized(thana) -> [{division,district,upazila,thana}, ...]

    const pushMulti = (map, key, value) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };

    Object.keys(locations).forEach(division => {
      divisions.push(division);
      divisionExact.set(normalizeForMatch(division), division);
      districtsByDivision[division] = [];

      const districts = locations[division] || {};
      Object.keys(districts).forEach(district => {
        districtsByDivision[division].push(district);
        allDistrictNamesSet.add(district);
        const dKey = `${division}|${district}`;
        districtExact.set(normalizeForMatch(dKey), { division, district });
        pushMulti(districtByNameOnly, normalizeForMatch(district), { division, district });

        const udKey = `${division}|${district}`;
        upazilasByDivisionDistrict[udKey] = [];

        const upazilas = districts[district] || {};
        Object.keys(upazilas).forEach(upazila => {
          upazilasByDivisionDistrict[udKey].push(upazila);
          allUpazilaNamesSet.add(upazila);
          const uKey = `${division}|${district}|${upazila}`;
          upazilaExact.set(normalizeForMatch(uKey), { division, district, upazila });
          pushMulti(upazilaByNameOnly, normalizeForMatch(upazila), { division, district, upazila });

          const thanas = upazilas[upazila] || [];
          const tPathKey = `${division}|${district}|${upazila}`;
          thanasByPath[tPathKey] = thanas.slice();

          thanas.forEach(thana => {
            allThanaNamesSet.add(thana);
            const tKey = `${division}|${district}|${upazila}|${thana}`;
            thanaExact.set(normalizeForMatch(tKey), { division, district, upazila, thana });
            pushMulti(thanaByNameOnly, normalizeForMatch(thana), { division, district, upazila, thana });
          });
        });
      });
    });

    return {
      divisions,
      districtsByDivision,
      upazilasByDivisionDistrict,
      thanasByPath,
      allDistrictNames: Array.from(allDistrictNamesSet),
      allUpazilaNames: Array.from(allUpazilaNamesSet),
      allThanaNames: Array.from(allThanaNamesSet),
      divisionExact,
      districtExact,
      districtByNameOnly,
      upazilaExact,
      upazilaByNameOnly,
      thanaExact,
      thanaByNameOnly,
      getDistricts(division) {
        return districtsByDivision[division] || [];
      },
      getUpazilas(division, district) {
        return upazilasByDivisionDistrict[`${division}|${district}`] || [];
      },
      getThanas(division, district, upazila) {
        return thanasByPath[`${division}|${district}|${upazila}`] || [];
      }
    };
  }

  // Designation/Role master (reuses FIXED_DESIGNATIONS/FIXED_ROLES from js/storage.js).
  // A small, explicitly-curated synonym table maps common free-text variants to the
  // fixed canonical values - never invents new roles, per the spec's safety rule.
  const DESIGNATION_ROLE_SYNONYMS = {
    'BUSINESS PROMOTER': 'BP',
    'BP': 'BP',
    'SUPERVISOR': 'Supervisor',
    'SUPER VISOR': 'Supervisor',
    'SUPRVISOR': 'Supervisor',
    'FIELD COORDINATOR': 'FC',
    'FC': 'FC'
  };

  function buildDesignationRoleIndex() {
    const values = (typeof window !== 'undefined' && window.storage && window.storage.getDesignations)
      ? window.storage.getDesignations()
      : ['BP', 'Supervisor', 'FC'];

    const exact = new Map(); // normalized value -> canonical value
    values.forEach(v => exact.set(normalizeForMatch(v), v));
    Object.keys(DESIGNATION_ROLE_SYNONYMS).forEach(syn => {
      exact.set(normalizeForMatch(syn), DESIGNATION_ROLE_SYNONYMS[syn]);
    });

    return { values, exact };
  }

  let locationIndex = null;
  let designationRoleIndex = null;

  function getLocationIndex() {
    if (!locationIndex) locationIndex = buildLocationIndex();
    return locationIndex;
  }

  function getDesignationRoleIndex() {
    if (!designationRoleIndex) designationRoleIndex = buildDesignationRoleIndex();
    return designationRoleIndex;
  }

  // Rebuild on demand (e.g. if BD_LOCATIONS or the designation list could change at runtime).
  function resetMasterIndex() {
    locationIndex = null;
    designationRoleIndex = null;
  }

  if (typeof window !== 'undefined') {
    window.getLocationIndex = getLocationIndex;
    window.getDesignationRoleIndex = getDesignationRoleIndex;
    window.resetMasterIndex = resetMasterIndex;
  }
})();
