use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Git was not found. Install Git and make sure it is on your PATH.")]
    GitNotFound,
    #[error("{message}")]
    Git { command: String, message: String },
    #[error("Not a Git repository: {0}")]
    NotARepo(String),
    #[error("Folder not found: {0}")]
    PathNotFound(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::GitNotFound => "gitNotFound",
            AppError::Git { .. } => "git",
            AppError::NotARepo(_) => "notARepo",
            AppError::PathNotFound(_) => "pathNotFound",
            AppError::Io(_) => "io",
            AppError::Internal(_) => "internal",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        let command = match self {
            AppError::Git { command, .. } => Some(command.as_str()),
            _ => None,
        };
        s.serialize_field("command", &command)?;
        s.end()
    }
}
