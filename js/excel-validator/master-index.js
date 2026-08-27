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

  // Agency/Campaign master (2-level hierarchy, same shape as Division->District above).
  // Unlike BD_LOCATIONS/FIXED_DESIGNATIONS, Agency/Campaign are DB-backed admin-managed
  // master data, not a static bundle - this is the one deliberate, minimal exception to
  // the Excel Validator's "fully offline" design: the caller (excel-validator-ui.js) fetches
  // window.EXCEL_VALIDATOR_MASTER_DATA = { agencies: [...], campaigns: [...] } from Supabase
  // ONCE at the start of the Validate step, and this index is built from that cached
  // snapshot - never a per-row or per-index-rebuild network call. Only Active
  // Agencies/Campaigns are offered as valid match targets.
  function buildAgencyCampaignIndex() {
    const data = (typeof window !== 'undefined' && window.EXCEL_VALIDATOR_MASTER_DATA) || {};
    const agenciesData = (data.agencies || []).filter(a => !a.status || a.status === 'Active');
    const campaignsData = (data.campaigns || []).filter(c => !c.status || c.status === 'Active');

    const agencyNameById = new Map();
    agenciesData.forEach(a => agencyNameById.set(a.id, a.name));

    const agencies = [];
    const campaignsByAgency = {};
    const allCampaignNamesSet = new Set();

    const agencyExact = new Map();          // normalized(agency) -> agency
    const campaignExact = new Map();        // normalized(agency|campaign) -> {agency,campaign}
    const campaignByNameOnly = new Map();   // normalized(campaign) -> [{agency,campaign}, ...]

    const pushMulti = (map, key, value) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };

    agenciesData.forEach(a => {
      agencies.push(a.name);
      agencyExact.set(normalizeForMatch(a.name), a.name);
      campaignsByAgency[a.name] = [];
    });

    campaignsData.forEach(c => {
      const agency = agencyNameById.get(c.agency_id);
      if (!agency || !campaignsByAgency[agency]) return; // parent Agency inactive/missing
      campaignsByAgency[agency].push(c.name);
      allCampaignNamesSet.add(c.name);
      const key = `${agency}|${c.name}`;
      campaignExact.set(normalizeForMatch(key), { agency, campaign: c.name });
      pushMulti(campaignByNameOnly, normalizeForMatch(c.name), { agency, campaign: c.name });
    });

    return {
      agencies,
      campaignsByAgency,
      allCampaignNames: Array.from(allCampaignNamesSet),
      agencyExact,
      campaignExact,
      campaignByNameOnly,
      getCampaigns(agency) {
        return campaignsByAgency[agency] || [];
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
  let agencyCampaignIndex = null;

  function getLocationIndex() {
    if (!locationIndex) locationIndex = buildLocationIndex();
    return locationIndex;
  }

  function getDesignationRoleIndex() {
    if (!designationRoleIndex) designationRoleIndex = buildDesignationRoleIndex();
    return designationRoleIndex;
  }

  function getAgencyCampaignIndex() {
    if (!agencyCampaignIndex) agencyCampaignIndex = buildAgencyCampaignIndex();
    return agencyCampaignIndex;
  }

  // Rebuild on demand (e.g. if BD_LOCATIONS/the designation list/EXCEL_VALIDATOR_MASTER_DATA
  // could change at runtime).
  function resetMasterIndex() {
    locationIndex = null;
    designationRoleIndex = null;
    agencyCampaignIndex = null;
  }

  if (typeof window !== 'undefined') {
    window.getLocationIndex = getLocationIndex;
    window.getDesignationRoleIndex = getDesignationRoleIndex;
    window.getAgencyCampaignIndex = getAgencyCampaignIndex;
    window.resetMasterIndex = resetMasterIndex;
  }
})();
