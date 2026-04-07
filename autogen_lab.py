import os
import autogen
import config

def main():
    # Load LLM API key from Synaptic config (which maps GEMINI_API_KEY -> OpenAI Key)
    openai_api_key = config.LLM_API_KEY
    if not openai_api_key:
        print("⚠️ LLM_API_KEY is missing in config.py. Please set it before running the lab.")
        return

    llm_config = {
        "config_list": [{"model": "gpt-4o", "api_key": openai_api_key}],
        "temperature": 0.2,
    }

    # 1. Performance Analyst
    analyst = autogen.AssistantAgent(
        name="Performance_Analyst",
        system_message="""You are an expert quantitative data analyst.
Your job is to write Python code to load and analyze `../data/tradebook.json` (remember to use this exact relative path). 
You must output a pandas summary of the win-rates and PnL, broken down by coin and direction.
Only output the python code in a Markdown code block, and let the User_Proxy run it. Do not guess results.""",
        llm_config=llm_config,
    )

    # 2. Quant Director
    quant = autogen.AssistantAgent(
        name="Quant_Director",
        system_message="""You are the Head of Algorithmic Trading Strategy.
Review the Performance_Analyst's data output.
If win-rates in certain segments or overall are sub-optimal, propose changes to `config.py` thresholds 
(like MIN_CONVICTION_FOR_DEPLOY, LOOP_INTERVAL_SECONDS, or SIDEWAYS_POSITION_REDUCTION).
Provide statistical reasoning for your proposed parameter changes.""",
        llm_config=llm_config,
    )

    # 3. Athena (Executive Framework)
    athena = autogen.AssistantAgent(
        name="Athena",
        system_message="""You are Athena, the ultimate execution and risk management engine of Synaptic.
You must rigorously review the Quant_Director's proposed config changes.
Ensure they do not increase maximum drawdown risk. Veto them if they suggest raising leverage or position caps.
Approve them if they are risk-neutral or risk-reducing. 
Once approved, compile the findings into a final `Strategy_Report.md` file summarizing your newly adopted rules.
After the report is finalized, YOU MUST output the exact word 'TERMINATE' to end the session.""",
        llm_config=llm_config,
    )

    # 4. User Proxy (Executor)
    user_proxy = autogen.UserProxyAgent(
        name="User_Proxy",
        system_message="A human admin executing the code.",
        code_execution_config={
            "last_n_messages": 3,
            "work_dir": "autogen_workspace",
            "use_docker": False,
        },
        human_input_mode="NEVER",  # Fully autonomous run
        max_consecutive_auto_reply=10,
        is_termination_msg=lambda x: x.get("content", "") and "TERMINATE" in x.get("content", "").upper(),
    )

    # Group Chat definition
    groupchat = autogen.GroupChat(
        agents=[user_proxy, analyst, quant, athena],
        messages=[],
        max_round=15
    )
    manager = autogen.GroupChatManager(groupchat=groupchat, llm_config=llm_config)

    print("🚀 Starting AutoGen R&D Lab...")
    
    # Start the conversation
    initial_prompt = (
        "Hello Team! Let's review our Synaptic engine performance.\n"
        "Analyst, please write a python script to load '../data/tradebook.json' "
        "and calculate total PnL and win rates. Then Quant, propose config fixes based on the real data. "
        "Athena, review it. Produce a final `strategy_report.md` file containing your recommended config changes, and then output TERMINATE."
    )
    
    chat_result = user_proxy.initiate_chat(
        manager,
        message=initial_prompt
    )

    # Save the entire debate transcript to a file for review
    import json
    with open("autogen_workspace/debate_transcript.json", "w") as f:
        json.dump(chat_result.chat_history, f, indent=4)
    
    print("\n✅ Debate completed! Transcript saved to autogen_workspace/debate_transcript.json")
    print("✅ Final decision saved by the Risk Controller in autogen_workspace/Strategy_Report.md")

if __name__ == "__main__":
    main()
