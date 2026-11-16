# Meetily Privacy Policy

*Last updated: [Current Date]*

## Our Privacy-First Commitment

Meetily is built on the principle that your meeting data should remain private and under your control. This privacy policy explains how we handle data in our open-source meeting assistant.

## Data Processing Philosophy

### Local-First Processing
- **Meeting transcription**: Processed entirely on your device using local Whisper models
- **Audio recordings**: Never transmitted to external servers
- **Meeting content**: Remains on your infrastructure
- **AI summaries**: Generated locally by the built-in engine, by Ollama, or by the provider or server you choose

### Your Data Ownership
- You own all meeting data, transcripts, and recordings
- Data is stored locally on your device
- No vendor lock-in - export your data anytime
- Complete control over data retention and deletion

## Network Activity

This build contains no analytics, telemetry, crash reporting, update checks or other background requests to remote servers. The only connections the app makes are:

- **Model downloads**: when a transcription, speaker or summary model is downloaded (during onboarding or from settings), the file is fetched from Hugging Face (`huggingface.co`). Nothing about your meetings is sent.
- **Summary providers you choose**: if you select Claude, Groq, OpenRouter or OpenAI (with your own API key), or point Meetily at an Ollama or OpenAI-compatible endpoint, summary requests (which include transcript text) and model-list lookups go to that provider. Nothing is sent unless you select one. The default is local (the app checks for a local Ollama at `localhost:11434`).
- **Links you click**: "open in browser" links are handed to your default browser. Meetily itself makes no request.

## Third-Party Services

### LLM Providers (Optional)
- **Built-in AI / Local Ollama**: Processed entirely on your device
- **Anthropic Claude, Groq, OpenRouter, OpenAI**: Optional; subject to each provider's privacy policy
- **Custom OpenAI-compatible server**: Processed by whichever server you configure


## Your Privacy Rights

### Data Control
- **Access**: View all data stored locally on your device
- **Export**: Export your data in standard formats
- **Delete**: Remove all data from your device


## Data Security

### Local Security
- Data encrypted at rest using your device's security features
- No transmission of sensitive meeting data
- Standard file system permissions protect your data

### Open Source Transparency
- Full source code available for security review
- Community-audited privacy implementations
- No hidden data collection or tracking

## Changes to This Policy

We will notify users of any material changes to this privacy policy through:
- Updates to this document in our GitHub repository
- Release notes for application updates
- In-app notifications for significant privacy changes

## Contact Us

For privacy-related questions or concerns:
- **GitHub Issues**: [Create an issue](https://github.com/Zackriya-Solutions/meeting-minutes/issues)
- **Email**: [Contact form](https://www.zackriya.com/service-interest-form/)
- **Community**: [Discord](https://discord.gg/crRymMQBFH)

## Open Source Commitment

As an open-source project under MIT license, you can:
- Review our complete privacy implementation
- Modify data handling to meet your requirements
- Deploy entirely on your own infrastructure
- Contribute to privacy improvements

---

*This privacy policy applies to Meetily v0.0.5 and later versions. For enterprise deployments, additional privacy controls may be available.*
