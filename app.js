const API_URL = "https://learn.reboot01.com/api/graphql-engine/v1/graphql";
const LOGIN_URL = "https://learn.reboot01.com/api/auth/signin";


const loginForm = document.getElementById("login-form");
const loginSection = document.getElementById("login-section");
const profileSection = document.getElementById("profile-section");
const logoutBtn = document.getElementById("logout-btn");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username-input").value;
  const password = document.getElementById("password-input").value;

  try {
    await login(username, password);
    loginSection.style.display = "none";
    profileSection.style.display = "block";
    init();
  } catch (err) {
    alert("Login failed: " + err.message);
  }
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("jwt");
  jwtToken = null;
  profileSection.style.display = "none";
  loginSection.style.display = "block";
});

if (localStorage.getItem("jwt")) {
  loginSection.style.display = "none";
  profileSection.style.display = "block";
  init();
}


let jwtToken = null;

async function login(username, password) {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${username}:${password}`)
    }
  });

  if (!res.ok) throw new Error("Login failed: " + res.statusText);

  const data = await res.json();
  jwtToken = data;
  localStorage.setItem("jwt", jwtToken);
  return jwtToken;
}

function getAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${jwtToken}`
  };
}

async function graphqlRequest(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) {
    console.error("GraphQL Error:", json.errors);
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

// --- Queries ---
async function fetchUserData() {
  const query = `{ 
    user {
      id 
      login
      email
      firstName
      lastName
      attrs
      createdAt
    } 
  }`;
  return graphqlRequest(query);
}

async function fetchTotalXp() {
  const query = `{
    transaction(
      where: {
        type: { _eq: "xp" }
        path: { _like: "/bahrain/bh-module/%" }
        _not: { path: { _like: "/bahrain/bh-module/piscine-js/%" } }
      }
      distinct_on: objectId
      order_by: [{ objectId: asc }, { createdAt: desc }]
    ) {
      amount
    }
  }`;

  const data = await graphqlRequest(query);
  return (data.transaction || []).reduce((sum, tx) => sum + tx.amount, 0);
}

async function fetchAuditRatio() {
  const query = `{
  user{
      auditRatio
    }
  }`
  return graphqlRequest(query)
}
async function fetchXpTransactions() {
  const query = `{
    transaction(
      where: {
        type: { _eq: "xp" }
        path: { _like: "/bahrain/bh-module/%" }
        _not: { path: { _like: "/bahrain/bh-module/piscine-js/%" } }
      }
      distinct_on: objectId
      order_by: [{ objectId: asc }, { createdAt: desc }]
    ) {
      amount
      createdAt
    }
  }`;
  return graphqlRequest(query);
}


async function fetchAuditTransactions() {
  const query = `{
    transaction(where: { type: { _in: ["up","down"] } }) {
      type
      amount
      createdAt
    }
  }`;
  return graphqlRequest(query);
}


async function fetchProgress() {
  const query = `{
    progress(
      order_by: { createdAt: desc }, 
      limit: 10, 
      where: { 
        path: { _like: "/bahrain/bh-module/%" }, 
        _not: { 
          _or: [
            { path: { _like: "/bahrain/bh-module/piscine-js/%" } },
            { path: { _like: "/bahrain/bh-module/checkpoint/%" } }
          ] 
        }
      }
    ) {
      grade
      createdAt
      path
      object { name }
    }
  }`;
  return graphqlRequest(query);
}




// --- Data Processing ---
function groupXpLast5MonthsWithTotal(transactions) {
  if (transactions.length === 0) return [];

  const now = new Date();
  const months = [];

  // Build last 5 months list
  for (let i = 4; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: `${d.toLocaleString("en", { month: "short" })}/${d.getFullYear()}`,
      xp: 0,
      month: d.getMonth(),
      year: d.getFullYear()
    });
  }

  // Sum XP per month
  transactions.forEach(tx => {
    const d = new Date(tx.createdAt);
    const label = `${d.toLocaleString("en", { month: "short" })}/${d.getFullYear()}`;
    const found = months.find(m => m.label === label);
    if (found) found.xp += tx.amount;
  });

  // Add total
  const totalXp = months.reduce((sum, m) => sum + m.xp, 0);
  months.push({
    label: "Total",
    xp: totalXp
  });

  return months;
}

function formatXp(value) {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(2) + "gb";
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + "mb";
  }
  if (value >= 1_000) {
     return Math.round(value / 1_000) + "kb";
  }
  return value.toString();
}



function renderXpGraph(months) {
  const svg = document.getElementById("xp-graph");
  svg.innerHTML = "";

  if (months.length === 0) {
    const msg = document.createElementNS("http://www.w3.org/2000/svg", "text");
    msg.setAttribute("x", 50);
    msg.setAttribute("y", 50);
    msg.textContent = "No XP data available";
    svg.appendChild(msg);
    return;
  }

  const width = parseInt(svg.getAttribute("width"));
  const height = parseInt(svg.getAttribute("height"));
  const barWidth = 60, gap = 35, offsetX = 50, offsetY = 40;

  const maxXp = Math.max(...months.map(m => m.xp), 1);
  const scaleY = (value) => (value / maxXp) * (height - 2 * offsetY);

  // Y axis
  const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  yAxis.setAttribute("x1", offsetX);
  yAxis.setAttribute("y1", offsetY);
  yAxis.setAttribute("x2", offsetX);
  yAxis.setAttribute("y2", height - offsetY);
  yAxis.setAttribute("stroke", "black");
  svg.appendChild(yAxis);

  // X axis
  const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  xAxis.setAttribute("x1", offsetX);
  xAxis.setAttribute("y1", height - offsetY);
  xAxis.setAttribute("x2", width - 10);
  xAxis.setAttribute("y2", height - offsetY);
  xAxis.setAttribute("stroke", "black");
  svg.appendChild(xAxis);

  // Y-axis ticks
  const numTicks = 5;
  for (let i = 0; i <= numTicks; i++) {
    const value = Math.round((maxXp / numTicks) * i);
    const y = height - offsetY - scaleY(value);

    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", offsetX - 5);
    tick.setAttribute("y1", y);
    tick.setAttribute("x2", offsetX);
    tick.setAttribute("y2", y);
    tick.setAttribute("stroke", "black");
    svg.appendChild(tick);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", offsetX - 10);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.textContent = value;
    svg.appendChild(label);
  }

  // Bars
  months.forEach((m, i) => {
    const barHeight = scaleY(m.xp);
    const x = offsetX + i * (barWidth + gap);
    const y = height - offsetY - barHeight;

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", barWidth);
    rect.setAttribute("height", barHeight);
    rect.setAttribute("fill", "#4CAF50");
    svg.appendChild(rect);

    // Month/year label
    const monthLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    monthLabel.setAttribute("x", x + barWidth / 2);
    monthLabel.setAttribute("y", height - offsetY + 15);
    monthLabel.setAttribute("text-anchor", "middle");
    monthLabel.textContent = m.label;
    svg.appendChild(monthLabel);

    // XP value
    if (m.xp > 0) {
      const value = document.createElementNS("http://www.w3.org/2000/svg", "text");
      value.setAttribute("x", x + barWidth / 2);
      value.setAttribute("y", y - 5);
      value.setAttribute("text-anchor", "middle");
      value.textContent = m.xp;
      svg.appendChild(value);
    }
  });
}



function getUserAudits(transactions) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  let given = 0, taken = 0;

  transactions.forEach(tx => {
    const d = new Date(tx.createdAt);
    const m = d.getMonth();
    const y = d.getFullYear();

    if (m === currentMonth && y === currentYear) {
      if (tx.type === "up") given++;
      if (tx.type === "down") taken++;
    }
  });

  return { given, taken };
}



// --- Graph Rendering ---


function renderUserAudits(audits) {
  const svg = document.getElementById("leaderboard-graph");
  svg.innerHTML = "";

  const width = parseInt(svg.getAttribute("width"));
  const height = parseInt(svg.getAttribute("height"));
  const radius = Math.min(width, height) / 3;
  const cx = width / 2;
  const cy = height / 2 - 10;

  const total = audits.given + audits.taken;

  if (total === 0) {
    const msg = document.createElementNS("http://www.w3.org/2000/svg", "text");
    msg.setAttribute("x", width / 2);
    msg.setAttribute("y", height / 2);
    msg.setAttribute("text-anchor", "middle");
    msg.textContent = "No audits this month";
    svg.appendChild(msg);
    return;
  }

  const slices = [
    { label: "Audits Given", value: audits.given, color: "#2196F3" },
    { label: "Audits Taken", value: audits.taken, color: "#FF9800" }
  ];

  let startAngle = 0;
  slices.forEach(slice => {
    if (slice.value === 0) return; // skip drawing empty slices

    const sliceAngle = (slice.value / total) * 2 * Math.PI;
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(startAngle + sliceAngle);
    const y2 = cy + radius * Math.sin(startAngle + sliceAngle);
    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    const pathData = [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      "Z"
    ].join(" ");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", slice.color);
    svg.appendChild(path);

    // Label (count + %)
    const midAngle = startAngle + sliceAngle / 2;
    const labelX = cx + (radius + 30) * Math.cos(midAngle);
    const labelY = cy + (radius + 30) * Math.sin(midAngle);

    const percent = ((slice.value / total) * 100).toFixed(1);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", labelX);
    text.setAttribute("y", labelY);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "12px");
    text.textContent = `${slice.label}: ${slice.value} (${percent}%)`;
    svg.appendChild(text);

    startAngle += sliceAngle;
  });

  // Ratio text under chart
  const ratio = calculateAuditRatio(audits.given, audits.taken);
  const ratioText = document.createElementNS("http://www.w3.org/2000/svg", "text");
  ratioText.setAttribute("x", width / 2);
  ratioText.setAttribute("y", height - 10);
  ratioText.setAttribute("text-anchor", "middle");
  ratioText.setAttribute("font-weight", "bold");
  ratioText.textContent = `Audit Ratio (Given/Taken): ${ratio}`;
  svg.appendChild(ratioText);
}



// --- Main Flow ---
async function init() {
  try {
    const user = await fetchUserData();
    const userData = user.user[0];

    document.getElementById("username").innerText = userData.login;
    document.getElementById("user-login").innerText = userData.login;
    document.getElementById("user-email").innerText = userData.email || "N/A";
    document.getElementById("user-firstname").innerText = userData.firstName || "N/A";
    document.getElementById("user-lastname").innerText = userData.lastName || "N/A";
    document.getElementById("user-join").innerText = new Date(userData.createdAt).toLocaleDateString();
    document.getElementById("user-phone").innerText = userData.attrs.PhoneNumber || "N/A";



    // Fetch XP
    const xpData = await fetchXpTransactions();
    const months = groupXpLast5MonthsWithTotal(xpData.transaction);
    renderXpGraph(months);

    // Total XP
    const totalXp = await fetchTotalXp();
    document.getElementById("total-xp").innerText = formatXp(totalXp);

    // Audits
    const auditData = await fetchAuditTransactions();
    const audits = getUserAudits(auditData.transaction);
    renderUserAudits(audits);


    // Audit ratio (from API)
   // Audit ratio (from API)
const auditRatioData = await fetchAuditRatio();
let auditRatio = auditRatioData.user[0].auditRatio;

// If we want to override API value with calculated:
auditRatio = calculateAuditRatio(audits.given, audits.taken);

document.getElementById("audit-ratio").innerText = auditRatio;

    // Round down if it's a number
    if (typeof auditRatio === "number") {
  auditRatio = (Math.round(auditRatio * 100) / 100).toFixed(1);
}


    document.getElementById("audit-ratio").innerText = auditRatio;


    // Recent Projects
    const progress = await fetchProgress();
    const list = document.getElementById("recent-projects");
    list.innerHTML = "";
    progress.progress.forEach(p => {
      const li = document.createElement("li");
      if (p.grade === 0) {
        li.textContent = `${p.object.name} – FAIL`;
        li.classList.add("fail");
      } else if (p.grade >= 1) {
        li.textContent = `${p.object.name} – PASS`;
        li.classList.add("pass");
      } else if (p.grade === null) {
        li.textContent = `${p.object.name} – IN PROGRESS`;
        li.classList.add("progress");
      } else {
        return;
      }
      list.appendChild(li);
    });

  } catch (err) {
    console.error(err);
  }
}



window.onload = () => {
  jwtToken = localStorage.getItem("jwt");
  if (jwtToken) init();
};
