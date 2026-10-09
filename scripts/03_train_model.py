import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error

# 1. Define PyTorch Model Architecture (60 -> 128 -> 64 -> 32 -> 12)
class TrafficMLP(nn.Module):
    def __init__(self, input_dim=60, output_dim=12):
        super(TrafficMLP, self).__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, output_dim)
        )

    def forward(self, x):
        return self.net(x)

def train_and_evaluate():
    print("Loading feature dataset...")
    df = pd.read_csv("data/dataset_60_12.csv")
    
    # Separate features (60 columns) and targets (12 columns)
    X_cols = [c for c in df.columns if not c.startswith('target_')]
    y_cols = [c for c in df.columns if c.startswith('target_')]
    
    X = df[X_cols].values
    y = df[y_cols].values

    # Train/Test Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # Standardize features
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_test = scaler.transform(X_test)

    # Convert to PyTorch Tensors
    X_train_t = torch.tensor(X_train, dtype=torch.float32)
    y_train_t = torch.tensor(y_train, dtype=torch.float32)
    X_test_t = torch.tensor(X_test, dtype=torch.float32)

    # Initialize model, loss function, and optimizer
    model = TrafficMLP(input_dim=60, output_dim=12)
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    # Training Loop
    print("Training PyTorch MLP model...")
    epochs = 100
    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        predictions = model(X_train_t)
        loss = criterion(predictions, y_train_t)
        loss.backward()
        optimizer.step()
        
        if (epoch + 1) % 20 == 0:
            print(f"Epoch {epoch+1}/{epochs} - Loss: {loss.item():.4f}")

    # Evaluation
    model.eval()
    with torch.no_grad():
        y_pred = model(X_test_t).numpy()

    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))

    print("\n==========================================")
    print("       MODEL EVALUATION RESULTS           ")
    print("==========================================")
    print(f"Mean Absolute Error (MAE):  {mae:.4f}")
    print(f"Root Mean Sq. Error (RMSE): {rmse:.4f}")
    print("==========================================\n")

    # Save trained model weights
    torch.save(model.state_dict(), "models/traffic_mlp.pth")
    print("Saved model checkpoint to models/traffic_mlp.pth")

if __name__ == "__main__":
    train_and_evaluate()# 1. Initialize git in your project folder
git init

# 2. Tell git to ignore heavy/temporary files (like virtual env and raw dataset)
echo "venv/" >> .gitignore
echo "data/ngsim_raw.csv" >> .gitignore

# 3. Add all your scripts, models, clean datasets, and README
git add .

# 4. Commit your changes with a message
git commit -m "Add ML preprocessing, feature extraction pipeline, and trained PyTorch MLP model"
