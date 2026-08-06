// Shared Request Hub / Launch Hub integration contract.
// Keep this file byte-for-byte identical in both repositories. The contract is
// deliberately data-only so Node CommonJS and ESM functions can both load it.
module.exports = Object.freeze({
  schemaVersion: '1.3.0',
  urls: {
    launch: 'https://launchcalendar.lemonadehospitality.com',
    requests: 'https://requests.lemonadehospitality.com'
  },
  users: {
    boardId: '18421837454',
    columns: {
      email: 'email_mm578403',
      role: 'color_mm57b54n',
      launchAccess: 'color_mm5qndfk',
      requestVisibility: 'dropdown_mm5w92c3',
      canTriage: 'boolean_mm5wy5jp',
      canManageIntegration: 'boolean_mm5w6vac'
    }
  },
  launch: {
    defaultBoardId: '18424230222',
    columns: {
      owner: 'person', status: 'color_mm5qkwxa', type: 'dropdown_mm5q4mx2', timeline: 'timerange_mkyp8kx7',
      workstream: 'dropdown_mm5qzg5z', outlet: 'dropdown_mm5qrjxf', priority: 'dropdown_mm5qd88r',
      liveDate: 'date_mm5qb732', dueDate: 'date_mm5q5w63', notes: 'text_mm5qj44n',
      area: 'dropdown_mm5xrqwr',
      sourceRequestId: 'text_mm5wzhq5', sourceRequest: 'link_mm5wbm8r', metadata: 'long_text_mm5wkgks'
    }
  },
  requestBoards: {
    procurement: { boardId: '18415967514', label: 'Procurement', area: 'dropdown_mm5znnsw' },
    uniform: { boardId: '18415985409', label: 'Uniform', area: 'dropdown_mm5zxw8s' },
    creative: { boardId: '18421786819', label: 'Creative', area: 'dropdown_mm5zr07b' },
    print: { boardId: '18421786829', label: 'Print', area: 'dropdown_mm5z3hjy' },
    beo: { boardId: '18395449895', label: 'Banquet Event Order', area: 'dropdown_mm5zxr2e' },
    general: { boardId: '18416054434', label: 'General', area: 'dropdown_mm5zr4wf' },
    business_card: { boardId: '18127686590', label: 'Business Card', area: 'dropdown_mm5zf4bn' },
    social: { boardId: '18409075892', label: 'Social', area: 'dropdown_mm5z3tvk' }
  },
  integrationColumns: {
    procurement: { requestId: 'text_mm5wntm5', familyId: 'text_mm5w38ba', parentId: 'text_mm5wtk63', metadata: 'long_text_mm5wq9ad', sync: 'color_mm5w7jyt', impact: 'color_mm5w26kz', workstream: 'dropdown_mm5w387t', priority: 'dropdown_mm5wy493', outlet: 'dropdown_mm5rm01q', liveDate: 'date_mm5rp6zz', milestoneLink: 'link_mm5wqgc8', programLink: 'link_mm5wfwm' },
    uniform: { requestId: 'text_mm5wbqvp', familyId: 'text_mm5wx47v', parentId: 'text_mm5wc30d', metadata: 'long_text_mm5wc32c', sync: 'color_mm5wpba9', impact: 'color_mm5wc10g', workstream: 'dropdown_mm5w73fh', priority: 'dropdown_mm5warg5', outlet: 'dropdown_mm5w45ch', liveDate: 'date_mm5wbgg7', milestoneLink: 'link_mm5wd96g', programLink: 'link_mm5wy0m0' },
    creative: { requestId: 'text_mm5wqsp4', familyId: 'text_mm5wfmqh', parentId: 'text_mm5wmdz5', metadata: 'long_text_mm5wp47w', sync: 'color_mm5w49ps', impact: 'color_mm5wbn6p', workstream: 'dropdown_mm5w7tfp', priority: 'dropdown_mm5wepat', outlet: 'dropdown_mm5ww1g9', liveDate: 'date_mm5w7dnp', milestoneLink: 'link_mm5wez99', programLink: 'link_mm5w2hnv' },
    print: { requestId: 'text_mm5wt9p', familyId: 'text_mm5w7tar', parentId: 'text_mm5wx3fr', metadata: 'long_text_mm5w4dp2', sync: 'color_mm5w8yyk', impact: 'color_mm5whzzn', workstream: 'dropdown_mm5wj7fx', priority: 'dropdown_mm5wa0zf', outlet: 'dropdown_mm5w922e', liveDate: 'date_mm5w30md', milestoneLink: 'link_mm5wysvm', programLink: 'link_mm5wpp1m' },
    beo: { requestId: 'text_mm5wfkf9', familyId: 'text_mm5wdmv3', parentId: 'text_mm5w9y9t', metadata: 'long_text_mm5wzmnn', sync: 'color_mm5wpwz8', impact: 'color_mm5wsh2r', workstream: 'dropdown_mm5wrh1k', priority: 'dropdown_mm5wdebr', outlet: 'dropdown_mm5wky56', requestedDate: 'date_mm5w4zkh', liveDate: 'date_mm58gm0p', milestoneLink: 'link_mm5wngks', programLink: 'link_mm5wwec6' },
    general: { requestId: 'text_mm5wn6sp', familyId: 'text_mm5wsfss', parentId: 'text_mm5wb7q0', metadata: 'long_text_mm5we3k5', sync: 'color_mm5wdpyy', impact: 'color_mm5wyv4t', workstream: 'dropdown_mm5wp336', priority: 'dropdown_mm5w4h88', outlet: 'dropdown_mm5wghtf', liveDate: 'date_mm5w8rdq', milestoneLink: 'link_mm5wkn6p', programLink: 'link_mm5wg06v' },
    business_card: { requestId: 'text_mm5w38ws', familyId: 'text_mm5wm72t', parentId: 'text_mm5w2797', metadata: 'long_text_mm5wtpet', sync: 'color_mm5wwpwt', impact: 'color_mm5wdwwa', workstream: 'dropdown_mm5wbd8f', priority: 'dropdown_mm5wspg8', outlet: 'dropdown_mm5wktj5', liveDate: 'date_mm5wghs9', team: 'dropdown_mm5wjexh', requestedDate: 'date_mm5wv528', milestoneLink: 'link_mm5wddpe', programLink: 'link_mm5wrfgf' },
    social: { requestId: 'text_mm5w82sv', familyId: 'text_mm5wqjed', parentId: 'text_mm5wza5g', metadata: 'long_text_mm5w1sxt', sync: 'color_mm5wryye' }
  },
  canonical: {
    // Physical area or department. Required on every request form; this is what the
    // Launch Hub groups on, so it must stay identical to the Monday dropdown labels.
    areas: ['Property-wide', 'Social / Content', 'Guest Services', 'Front Office', 'Lobby', 'Elevator', 'Elevator / Vestibule', 'Lovebirds', 'Lovebirds Habitat', 'Pool & Beach', 'Citrus Shack', 'Julene', 'Knook', 'Engineering', 'Guestrooms', 'Corridors', 'HR', 'Housekeeping', 'Sales', 'Merchandise', 'Minibar / IRD'],
    outlets: ['Campaigns', 'The Sunny', 'Julene', 'Citrus Shack', 'Lovebirds', 'Sandbar', 'Newport Room', 'Pool / Beach', 'Rooms / E-commerce', 'Lobby', 'Porte Cochere'],
    workstreams: ['Partnerships', 'Programming & Activations', 'Content Creation / Organic Social', 'PR', 'Paid Social / Media', 'Digital', 'Influencers', 'Campaign', 'Brand', 'Misc Procurement'],
    priorities: ['P0 - Blocker', 'P0 - Deadline', 'P0 - Launch', 'P1 - This Week', 'P1 - August', 'P1 - September', 'P2 - July', 'P3 - Post Launch']
  }
});
