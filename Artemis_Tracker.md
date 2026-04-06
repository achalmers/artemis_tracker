//AlexC 4/1/2026 Updated Claude.md file for expense tracker  ( CONTEXT guideline )

This project is named ARTEMIS_TRACKER, the goal is to create an application that displays the current location of the Artemis 2 spacecraft. 

SYSTEM REQUIREMENTS AND APPLICATION OVERVIEW:
Build a standalone, complete web app that displays the track and current position of the Artemis 2 spacecraft. A 3d display to show the earth, moon, current position and track of the Artemis spacecraft. 

FUNCTIONAL REQUIREMENTS:
- display a color 3d representation of the earth, moon and spacecraft location and its track.
- access a tracking website every 5 minutes to find the current location of the Artemis 2 spacecraft
- display  the current position of the spacecraft and its track since launch in red as well as its intended track for the rest of the mission in cyan.
- user shall be able to manipulate the orientation and scale of the displayed image to allow visualization of the 3 bodies (side on, top down wrt to the plane of the earths orbit.


IMPLEMENTATION REQUIREMENTS:
- HTML5 with App Router


DESIGN REQUIREMENTS:
- Clean, modern interface with a professional color scheme
- Intuitive navigation and user experience
- Visual feedback for user actions


SPECIFIC FUNCTIONALITY:
- viewable from local web browser
- GUI to display of 3d graphics objects as well as tabular text and numeric data (time, distance of the spacecraft from the surface of the earth in Km)


TESTING
Create a suite of automated tests in a separate directory to enable the demonstration of all unique features.

DOCUMENTATION

Produce a summary of the implementation in pdf format summarizing test execution and test results.

Create this as a complete, production-ready application. Set up the project structure, implement all features, and make sure everything works together seamlessly. Focus on creating something that looks professional.


When you're done, provide instructions on how to run the application and test all features.





------------------------------------------------------------

Install directions :
Download to directory

To run app:
Browser Ctrl+o  to open file
Select file : C:\Users\alexl\claude_projects\artemis_tracker\index.html

To run tests :
cd C:\Users\alexl\claude_projects\artemis_tracker
python server.py
Ctrl+LeftClick on the tests region displayed
Select the RunTests Button

"save this conversation to current directory, list the filename used" ..... produces conversation_2026-04-02.md  3103
use "claude --resume   or--continue"


Note that 3 errors were fixed iteratively by inspecting the GUI and test results. Claude was able to identify the causes and fix them.


