# Git Setup Instructions

Git has been installed and the repository has been initialized! Follow these steps to complete the setup:

## 1. Configure Git Identity (Required for GitHub)

Open a **new** PowerShell or Command Prompt window (to get the updated PATH), then run:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

Use the same email associated with your GitHub account for best results.

## 2. Stage and Commit Your Files

In your project directory, run:

```bash
git add .
git commit -m "Initial commit"
```

## 3. Create a GitHub Repository

1. Go to https://github.com/new
2. Create a new repository (you can name it `cc-world-server` or any name you prefer)
3. **Do NOT** initialize it with a README, .gitignore, or license (we already have these)
4. Copy the repository URL (it will look like `https://github.com/username/repo-name.git`)

## 4. Connect Your Local Repository to GitHub

Run these commands (replace the URL with your actual repository URL):

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

You may be prompted to authenticate. GitHub now requires a Personal Access Token instead of passwords:
- Go to https://github.com/settings/tokens
- Generate a new token (classic) with `repo` permissions
- Use the token as your password when prompted

## 5. Verify

Check that everything is set up correctly:

```bash
git remote -v
git status
```

That's it! Your code is now on GitHub.


