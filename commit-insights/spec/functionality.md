# Commit Insights - User Commit Production Tracker

## Purpose

A single-page web application for visualizing a GitHub user's commit activity over time. Shows commit production patterns, activity trends, and contribution statistics.

## Features

### User Input
- Accept GitHub username
- Fetch user's public commit activity via GitHub API
- Display user profile information (avatar, name, stats)

### Commit Timeline
- Visualize commits over time with interactive chart
- Show daily/weekly/monthly commit counts
- Display commit activity heatmap (similar to GitHub's contribution graph)
- Time range selection (last 7 days, 30 days, 90 days, year, all time)

### Statistics Dashboard
- Total commits in selected period
- Most active day/week/month
- Average commits per day/week
- Longest streak of consecutive days with commits
- Current streak
- Repository breakdown (top repositories by commit count)

### Commit Details
- List recent commits with:
  - Repository name
  - Commit message
  - Timestamp
  - Additions/deletions (if available)
- Filter by date range
- Search by commit message or repository

### Visualization
- Line chart showing commits over time
- Heatmap calendar view (GitHub-style contribution graph)
- Bar chart for repository distribution
- Responsive design that adapts to different screen sizes

## Technical Constraints
- Single HTML file with inline CSS/JS
- No frameworks (vanilla JavaScript)
- Works with GitHub Pages
- Uses GitHub API for data fetching
- Minimalist grayscale design
- Handle API rate limiting gracefully

## Data Sources

### GitHub API Endpoints
- `/users/{username}` - User profile data
- `/users/{username}/events/public` - Recent public events (last 90 days)
- `/search/commits?q=author:{username}` - Search for commits (requires auth for full access)
- `/repos/{owner}/{repo}/commits?author={username}` - Commits in specific repos

### Approach
Use the Events API to get recent activity and aggregate commit data from push events. This provides commit counts, repository information, and timestamps without requiring authentication.
