# Mortgage Diary - Azure Deployment Guide

## Prerequisites
- Azure account (create free at https://azure.microsoft.com/free/)
- Azure CLI installed (https://docs.microsoft.com/cli/azure/install-azure-cli)
- Git installed

## Deployment Steps

### Option 1: Deploy using Azure CLI (Recommended)

1. **Login to Azure**
   ```powershell
   az login
   ```

2. **Create a Resource Group**
   ```powershell
   az group create --name MortgageDiaryRG --location eastus
   ```

3. **Create App Service Plan (Free tier)**
   ```powershell
   az appservice plan create --name MortgageDiaryPlan --resource-group MortgageDiaryRG --sku F1 --is-linux
   ```

4. **Create Web App**
   ```powershell
   az webapp create --resource-group MortgageDiaryRG --plan MortgageDiaryPlan --name mortgage-diary-<your-unique-name> --runtime "NODE:18-lts"
   ```
   Replace `<your-unique-name>` with something unique (e.g., your name or random string)

5. **Configure Deployment from Local Git**
   ```powershell
   az webapp deployment source config-local-git --name mortgage-diary-<your-unique-name> --resource-group MortgageDiaryRG
   ```

6. **Get Deployment Credentials**
   ```powershell
   az webapp deployment list-publishing-credentials --name mortgage-diary-<your-unique-name> --resource-group MortgageDiaryRG --query "{Username:publishingUserName, Password:publishingPassword}" --output table
   ```

7. **Deploy Application**
   ```powershell
   cd C:\repos\MortgageDiary
   git init
   git add .
   git commit -m "Initial commit"
   git remote add azure <git-url-from-step-5>
   git push azure main
   ```

### Option 2: Deploy using VS Code Azure Extension

1. Install "Azure App Service" extension in VS Code
2. Sign in to Azure
3. Right-click on MortgageDiary folder
4. Select "Deploy to Web App"
5. Follow the prompts

### Option 3: Deploy using Azure Portal (ZIP Deploy)

1. Go to Azure Portal (https://portal.azure.com)
2. Create a new "Web App"
   - Resource Group: Create new "MortgageDiaryRG"
   - Name: mortgage-diary-<your-unique-name>
   - Runtime: Node 18 LTS
   - Region: Choose nearest
   - Pricing: Free F1
3. After creation, go to Deployment Center
4. Choose "Local Git" or "GitHub"
5. Compress MortgageDiary folder to .zip (exclude node_modules)
6. Use Kudu console to upload and deploy

## Post-Deployment

1. **Access your app**
   ```
   https://mortgage-diary-<your-unique-name>.azurewebsites.net
   ```

2. **View logs**
   ```powershell
   az webapp log tail --name mortgage-diary-<your-unique-name> --resource-group MortgageDiaryRG
   ```

3. **Configure Always On** (if using paid tier)
   ```powershell
   az webapp config set --name mortgage-diary-<your-unique-name> --resource-group MortgageDiaryRG --always-on true
   ```

## Important Notes

- **Free Tier Limitations**: 
  - App sleeps after 20 minutes of inactivity
  - 60 minutes of CPU time per day
  - No custom domain SSL

- **Data Persistence**: 
  - JSON file is stored on App Service filesystem
  - Data persists during app restarts
  - For production, consider using Azure Storage or Database

- **Backup**: 
  - Use the CSV export feature regularly
  - Free tier doesn't include automated backups

## Upgrading to Production

For production use with always-on and better performance:
```powershell
az appservice plan update --name MortgageDiaryPlan --resource-group MortgageDiaryRG --sku B1
```

## Troubleshooting

- Check logs: `az webapp log tail`
- Restart app: `az webapp restart --name mortgage-diary-<your-unique-name> --resource-group MortgageDiaryRG`
- SSH into container: Go to Azure Portal > App Service > SSH
