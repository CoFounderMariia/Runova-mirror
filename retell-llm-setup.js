#!/usr/bin/env node
/**
 * Retell LLM Response Engine Setup Script
 * Creates a Retell LLM and attaches it to an existing agent
 */

const { RetellClient } = require("retell-sdk");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Colors for console output
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
};

function log(message, color = "reset") {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
    log(`❌ ${message}`, "red");
}

function success(message) {
    log(`✅ ${message}`, "green");
}

function info(message) {
    log(`ℹ️  ${message}`, "blue");
}

function warning(message) {
    log(`⚠️  ${message}`, "yellow");
}

// Initialize Retell client
function getRetellClient() {
    let apiKey = process.env.RETELL_API_KEY;
    
    // Fallback: try to read from retell_realtime.py
    if (!apiKey) {
        const retellRealtimePath = path.join(__dirname, "retell_realtime.py");
        if (fs.existsSync(retellRealtimePath)) {
            try {
                const content = fs.readFileSync(retellRealtimePath, "utf8");
                const match = content.match(/RETELL_API_KEY\s*=\s*["']([^"']+)["']/);
                if (match) {
                    apiKey = match[1];
                    info("Using API key from retell_realtime.py");
                }
            } catch (err) {
                warning(`Failed to read retell_realtime.py: ${err.message}`);
            }
        }
    }
    
    if (!apiKey) {
        error("RETELL_API_KEY not found");
        info("Please create a .env file with: RETELL_API_KEY=key_...");
        info("Or set it in retell_realtime.py");
        process.exit(1);
    }
    
    if (!apiKey.startsWith("key_")) {
        warning("API key format may be incorrect (should start with 'key_')");
    }
    
    try {
        const client = new RetellClient({
            apiKey: apiKey,
        });
        return { client, apiKey };
    } catch (err) {
        error(`Failed to initialize Retell client: ${err.message}`);
        process.exit(1);
    }
}

// Step 1: Create a new LLM Response Engine
async function createLLM() {
    log("\n📝 Step 1: Creating Retell LLM Response Engine...", "cyan");
    
    const { apiKey } = getRetellClient();
    
    try {
        info("Creating LLM with GPT-4o Realtime...");
        
        // Use direct API call since SDK doesn't have LLM methods
        const response = await axios.post(
            "https://api.retellai.com/create-retell-llm",
            {
                s2s_model: "gpt-4o-realtime",
                model_high_priority: true,
                model_temperature: 0.2,
            },
            {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );
        
        const llmResponse = response.data;
        
        if (!llmResponse || !llmResponse.llm_id) {
            error("Failed to create LLM: Invalid response from API");
            process.exit(1);
        }
        
        success(`LLM created successfully!`);
        log(`   LLM ID: ${llmResponse.llm_id}`, "bright");
        
        // Save LLM ID to a file for later use
        const llmData = {
            llm_id: llmResponse.llm_id,
            created_at: new Date().toISOString(),
            s2s_model: "gpt-4o-realtime",
        };
        
        fs.writeFileSync(
            path.join(__dirname, "retell_llm_config.json"),
            JSON.stringify(llmData, null, 2)
        );
        
        info("LLM configuration saved to retell_llm_config.json");
        
        return llmResponse.llm_id;
    } catch (err) {
        error(`Failed to create LLM: ${err.message}`);
        if (err.response) {
            error(`API Response: ${JSON.stringify(err.response.data, null, 2)}`);
            error(`Status: ${err.response.status}`);
        }
        process.exit(1);
    }
}

// Step 2: List all agents
async function listAgents() {
    log("\n📋 Listing all Retell agents...", "cyan");
    
    const { client, apiKey } = getRetellClient();
    
    try {
        // Use direct API call since SDK method might not work
        const response = await axios.get(
            "https://api.retellai.com/list-retell-llms",
            {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );
        
        // Try to get agents via API
        let agents = [];
        try {
            const agentsResponse = await axios.get(
                "https://api.retellai.com/list-chat-agents",
                {
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                }
            );
            agents = agentsResponse.data || [];
        } catch (err) {
            // If list-chat-agents doesn't work, try alternative endpoint
            warning("Could not fetch agents list via API, using agent ID from config");
            // Return empty array, we'll use the agent ID from retell_realtime.py
            return [];
        }
        
        if (!agents || agents.length === 0) {
            warning("No agents found via API, will use agent ID from retell_realtime.py");
            return [];
        }
        
        log(`\nFound ${agents.length} agent(s):`, "bright");
        agents.forEach((agent, index) => {
            const name = agent.agent_name || agent.name || "Unnamed";
            const id = agent.agent_id || agent.id || "N/A";
            const hasLLM = agent.llm_id ? "✅" : "❌";
            log(`   ${index + 1}. ${name}`, "bright");
            log(`      ID: ${id}`);
            log(`      LLM: ${hasLLM} ${agent.llm_id || "Not configured"}`);
        });
        
        return agents;
    } catch (err) {
        warning(`Could not list agents via API: ${err.message}`);
        warning("Will use agent ID from retell_realtime.py instead");
        return [];
    }
}

// Step 3: Find agent by name or ID
function findAgent(agents, searchTerm) {
    if (!searchTerm) {
        return null;
    }
    
    // Try to find by ID first
    let agent = agents.find(a => a.agent_id === searchTerm);
    if (agent) {
        return agent;
    }
    
    // Try to find by name (case-insensitive)
    const searchLower = searchTerm.toLowerCase();
    agent = agents.find(a => {
        const name = (a.agent_name || "").toLowerCase();
        return name.includes(searchLower) || name === searchLower;
    });
    
    return agent;
}

// Step 4: Attach LLM to agent
async function attachLLMToAgent(agentId, llmId) {
    log("\n🔗 Step 2: Attaching LLM to agent...", "cyan");
    
    if (!agentId) {
        error("Agent ID is required");
        process.exit(1);
    }
    
    if (!llmId) {
        error("LLM ID is required");
        process.exit(1);
    }
    
    const { client, apiKey } = getRetellClient();
    
    try {
        info(`Attaching LLM ${llmId} to agent ${agentId}...`);
        
        // Try using Retell SDK first
        let agent = null;
        try {
            // Try SDK method if available
            if (client && typeof client.chatAgent === 'object' && client.chatAgent.update) {
                info("Using Retell SDK to update agent...");
                const updated = await client.chatAgent.update(agentId, {
                    llm_id: llmId,
                });
                agent = updated.object || updated;
            }
        } catch (sdkErr) {
            warning(`SDK method failed: ${sdkErr.message}, trying direct API...`);
        }
        
        // Fallback to direct API call
        if (!agent) {
            info("Using direct API call to update agent...");
            const response = await axios.patch(
                `https://api.retellai.com/v2/chat-agent/${agentId}`,
                {
                    llm_id: llmId,
                },
                {
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                }
            );
            agent = response.data || {};
        }
        
        // Success if we got here without error
        success("LLM attached to agent successfully!");
        log(`   Agent ID: ${agentId}`);
        log(`   LLM ID: ${llmId}`);
        
        // Update retell_realtime.py if it exists
        updateRetellRealtimeConfig(llmId);
        
        return { agent_id: agentId, llm_id: llmId, ...agent };
    } catch (err) {
        error(`Failed to attach LLM to agent: ${err.message}`);
        if (err.response) {
            error(`API Response: ${JSON.stringify(err.response.data, null, 2)}`);
            error(`Status: ${err.response.status}`);
        }
        if (err.response?.status === 404) {
            error("Agent not found. Please check the agent ID.");
        } else if (err.response?.status === 401) {
            error("Unauthorized. Please check your API key.");
        }
        process.exit(1);
    }
}

// Update retell_realtime.py with new LLM ID
function updateRetellRealtimeConfig(llmId) {
    const retellRealtimePath = path.join(__dirname, "retell_realtime.py");
    
    if (!fs.existsSync(retellRealtimePath)) {
        warning("retell_realtime.py not found, skipping config update");
        return;
    }
    
    try {
        let content = fs.readFileSync(retellRealtimePath, "utf8");
        
        // Update RETELL_LLM_ID if it exists
        if (content.includes("RETELL_LLM_ID")) {
            content = content.replace(
                /RETELL_LLM_ID\s*=\s*["'][^"']*["']/,
                `RETELL_LLM_ID = "${llmId}"`
            );
            fs.writeFileSync(retellRealtimePath, content);
            info("Updated RETELL_LLM_ID in retell_realtime.py");
        } else {
            // Add it if it doesn't exist
            const apiKeyLine = content.match(/RETELL_API_KEY\s*=\s*["'][^"']*["']/);
            if (apiKeyLine) {
                const insertPos = content.indexOf(apiKeyLine[0]) + apiKeyLine[0].length;
                content = content.slice(0, insertPos) + 
                    `\nRETELL_LLM_ID = "${llmId}"` + 
                    content.slice(insertPos);
                fs.writeFileSync(retellRealtimePath, content);
                info("Added RETELL_LLM_ID to retell_realtime.py");
            }
        }
    } catch (err) {
        warning(`Failed to update retell_realtime.py: ${err.message}`);
    }
}

// Main function: Auto setup (create + attach)
async function autoSetup(agentSearchTerm) {
    log("\n🚀 Starting automatic Retell LLM setup...", "bright");
    
    // Step 1: Create LLM
    const llmId = await createLLM();
    
    // Step 2: List agents
    const agents = await listAgents();
    
    // Step 3: Find agent
    let agent = null;
    let agentId = null;
    
    // Try to get agent ID from retell_realtime.py if agents list is empty
    if (agents.length === 0) {
        info("No agents found via API, trying to use agent ID from retell_realtime.py");
        const retellRealtimePath = path.join(__dirname, "retell_realtime.py");
        if (fs.existsSync(retellRealtimePath)) {
            try {
                const content = fs.readFileSync(retellRealtimePath, "utf8");
                const match = content.match(/RETELL_AGENT_ID\s*=\s*["']([^"']+)["']/);
                if (match) {
                    agentId = match[1];
                    info(`Using agent ID from retell_realtime.py: ${agentId}`);
                    agent = { agent_id: agentId, agent_name: "From config" };
                }
            } catch (err) {
                warning(`Failed to read retell_realtime.py: ${err.message}`);
            }
        }
        
        if (!agent) {
            error("No agents found and could not read agent ID from config.");
            error("Please specify agent ID manually: node retell-llm-setup.js attach <agent_id> <llm_id>");
            process.exit(1);
        }
    } else {
        // Use agent search logic if agents list is available
        if (agentSearchTerm) {
            agent = findAgent(agents, agentSearchTerm);
            if (!agent) {
                error(`Agent not found: ${agentSearchTerm}`);
                log("\nAvailable agents:", "bright");
                agents.forEach((a, i) => {
                    log(`   ${i + 1}. ${a.agent_name || "Unnamed"} (${a.agent_id})`);
                });
                process.exit(1);
            }
        } else {
            // Auto-detect: look for "RUNOVA" or "Multi-State Agent" or "Multi-Prompt"
            const autoDetectNames = ["runova", "multi-state", "multi-prompt", "multi state", "multi prompt"];
            for (const name of autoDetectNames) {
                agent = findAgent(agents, name);
                if (agent) {
                    info(`Auto-detected agent: ${agent.agent_name || agent.agent_id}`);
                    break;
                }
            }
            
            if (!agent) {
                // Use first agent if auto-detect fails
                agent = agents[0];
                warning(`Auto-detect failed, using first agent: ${agent.agent_name || agent.agent_id}`);
            }
        }
    }
    
    // Step 4: Attach LLM
    await attachLLMToAgent(agent.agent_id, llmId);
    
    success("\n🎉 Setup complete! Your Retell agent now has a Response Engine.");
    info("You can now restart your server and test Runova voice responses.");
}

// Command-line interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    log("🔧 Retell LLM Response Engine Setup", "bright");
    log("=" .repeat(50), "cyan");
    
    if (!command || command === "help" || command === "--help" || command === "-h") {
        log("\nUsage:", "bright");
        log("  node retell-llm-setup.js create              - Create a new LLM");
        log("  node retell-llm-setup.js list                - List all agents");
        log("  node retell-llm-setup.js attach <agent_id> <llm_id>  - Attach LLM to agent");
        log("  node retell-llm-setup.js auto [agent_name]   - Auto setup (create + attach)");
        log("\nExamples:", "bright");
        log("  node retell-llm-setup.js auto");
        log("  node retell-llm-setup.js auto RUNOVA");
        log("  node retell-llm-setup.js create");
        log("  node retell-llm-setup.js attach agent_123 llm_456");
        process.exit(0);
    }
    
    try {
        switch (command) {
            case "create":
                await createLLM();
                break;
                
            case "list":
                await listAgents();
                break;
                
            case "attach":
                const agentId = args[1];
                const llmId = args[2];
                if (!agentId || !llmId) {
                    error("Usage: node retell-llm-setup.js attach <agent_id> <llm_id>");
                    process.exit(1);
                }
                await attachLLMToAgent(agentId, llmId);
                break;
                
            case "auto":
                const agentSearchTerm = args[1];
                await autoSetup(agentSearchTerm);
                break;
                
            default:
                error(`Unknown command: ${command}`);
                log("Run 'node retell-llm-setup.js help' for usage information.");
                process.exit(1);
        }
    } catch (err) {
        error(`Unexpected error: ${err.message}`);
        if (err.stack) {
            log(err.stack, "red");
        }
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main().catch(err => {
        error(`Fatal error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    createLLM,
    listAgents,
    attachLLMToAgent,
    autoSetup,
};

